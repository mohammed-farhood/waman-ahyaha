const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { normalize, hmac } = require('../services/phone');
const { write: audit }    = require('../services/audit');
const { authRequired, isMobile } = require('../middleware/auth');
const { body: validate, phoneRaw, pinRaw, strongPin } = require('../middleware/validate');
const { loginLimiter, registerDonorLimiter } = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

const COOKIE_OPTS = () => ({
  httpOnly: true,
  sameSite: process.env.COOKIE_SAMESITE || 'Strict',
  secure: process.env.COOKIE_SECURE === 'true',
});

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, groupId: user.group_id },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

async function signRefresh(userId, ip, ua, client) {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await client.query(
    'INSERT INTO sessions(refresh_token_hash,user_id,ip,ua,expires_at) VALUES($1,$2,$3::inet,$4,$5)',
    [hash, userId, ip || null, ua || null, expiresAt]
  );
  return raw;
}

const SAFE_COLS = 'id,name,phone,role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id,created_at,updated_at';

// Create a session row. The web gets httpOnly cookies; the mobile app
// (X-Client: mobile) gets the tokens back to keep in its secure storage.
async function issueSession(res, user, req) {
  const client = await pool.connect();
  let refreshRaw;
  try {
    await client.query('BEGIN');
    refreshRaw = await signRefresh(user.id, req.ip, req.headers['user-agent'], client);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  const accessToken = signAccess(user);
  if (isMobile(req)) return { accessToken, refreshToken: refreshRaw };
  res.cookie('waman_at', accessToken, { ...COOKIE_OPTS(), maxAge: 15 * 60 * 1000 });
  res.cookie('waman_rt', refreshRaw,  { ...COOKIE_OPTS(), maxAge: 30 * 24 * 3600 * 1000, path: '/api/auth' });
  return {};
}

// Refresh token from the cookie (web) or the request body (mobile).
function refreshFromReq(req) {
  return req.cookies?.waman_rt || (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '');
}

// POST /api/auth/login
router.post('/login', loginLimiter, validate(z.object({
  phone: phoneRaw,
  pin: z.string().nullable().optional(),
})), async (req, res, next) => {
  try {
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone_hash=$1 AND deleted_at IS NULL',
      [phoneHash]
    );
    const user = rows[0];

    // Generic error — don't reveal whether phone exists
    const GENERIC = 'phone or PIN incorrect';

    if (!user) return res.status(401).json({ success: false, error: GENERIC });

    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(429).json({ success: false, error: 'account locked, try again later' });
    }

    // Privileged roles require PIN
    if (['superadmin', 'admin', 'collector'].includes(user.role)) {
      if (!req.body.pin) return res.json({ success: true, require_pin: true });
      const ok = await bcrypt.compare(String(req.body.pin), user.pin_hash || '');
      if (!ok) {
        const attempts = (user.failed_attempts || 0) + 1;
        const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await pool.query(
          'UPDATE users SET failed_attempts=$1, locked_until=$2 WHERE id=$3',
          [attempts, lock, user.id]
        );
        return res.status(401).json({ success: false, error: GENERIC });
      }
    }

    // Reset lockout
    await pool.query('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [user.id]);

    const tokens = await issueSession(res, user, req);

    const { pin_hash, phone_hash, failed_attempts, locked_until, deleted_at, ...safeUser } = user;
    await audit({ actorId: user.id, action: 'login', entityType: 'user', entityId: user.id, ip: req.ip, ua: req.headers['user-agent'] });

    res.json({ success: true, user: safeUser, ...tokens });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = refreshFromReq(req);
    if (!raw) return res.status(401).json({ success: false, error: 'no refresh token' });

    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const { rows } = await pool.query(
      'SELECT * FROM sessions WHERE refresh_token_hash=$1 AND expires_at > now()',
      [hash]
    );
    if (!rows[0]) return res.status(401).json({ success: false, error: 'session expired' });

    const session = rows[0];
    const { rows: ur } = await pool.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [session.user_id]);
    if (!ur[0]) return res.status(401).json({ success: false, error: 'user not found' });

    // Rotate refresh token
    await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [hash]);
    const client = await pool.connect();
    let newRaw;
    try {
      await client.query('BEGIN');
      newRaw = await signRefresh(ur[0].id, req.ip, req.headers['user-agent'], client);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const accessToken = signAccess(ur[0]);
    if (isMobile(req)) return res.json({ success: true, accessToken, refreshToken: newRaw });
    res.cookie('waman_at', accessToken, { ...COOKIE_OPTS(), maxAge: 15 * 60 * 1000 });
    res.cookie('waman_rt', newRaw, { ...COOKIE_OPTS(), maxAge: 30 * 24 * 3600 * 1000, path: '/api/auth' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
// No authRequired: once the 15-minute access cookie has expired the refresh
// session must still be revoked and both cookies cleared.
router.post('/logout', async (req, res, next) => {
  try {
    const raw = refreshFromReq(req);
    if (raw) {
      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [hash]);
    }
    res.clearCookie('waman_at', COOKIE_OPTS());
    res.clearCookie('waman_rt', { ...COOKIE_OPTS(), path: '/api/auth' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SAFE_COLS} FROM users WHERE id=$1 AND deleted_at IS NULL`,
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'user not found' });
    res.json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/auth/register-donor
router.post('/register-donor', registerDonorLimiter, validate(z.object({
  name:        z.string().min(2).max(100),
  phone:       phoneRaw,
  groupId:     z.string().min(1),
  collectorId: z.string().nullable().optional(),
  amount:      z.number().int().min(0).max(100_000_000).nullable().optional(),
  isAnonymous: z.boolean().nullable().optional(),
})), async (req, res, next) => {
  try {
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);

    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1 AND deleted_at IS NULL', [phoneHash]);
    if (existing.rows[0]) return res.status(409).json({ success: false, error: 'phone already registered' });

    const { rows: grp } = await pool.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL', [req.body.groupId]);
    if (!grp[0]) return res.status(400).json({ success: false, error: 'unknown campaign' });

    // Only accept a collector that really collects for this campaign.
    let collectorId = null;
    if (req.body.collectorId) {
      const { rows: col } = await pool.query(
        "SELECT id FROM users WHERE id=$1 AND group_id=$2 AND role='collector' AND deleted_at IS NULL",
        [req.body.collectorId, req.body.groupId]
      );
      collectorId = col[0]?.id || null;
    }

    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO users (id,name,phone,phone_hash,role,group_id,collector_id,amount,is_anonymous)
       VALUES ($1,$2,$3,$4,'donor',$5,$6,$7,$8)`,
      [id, req.body.name, phone, phoneHash, req.body.groupId, collectorId,
       req.body.amount || 0, !!req.body.isAnonymous]
    );
    const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [id]);
    await audit({ action: 'register_donor', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    // Donors log in with their phone alone, so registering signs them in.
    const tokens = await issueSession(res, rows[0], req);
    res.status(201).json({ success: true, user: rows[0], ...tokens });
  } catch (err) { next(err); }
});

// POST /api/auth/register-collector  (admin/superadmin only)
router.post('/register-collector', authRequired, validate(z.object({
  name:        z.string().min(2).max(100),
  phone:       phoneRaw,
  pin:         strongPin,
  groupId:     z.string().min(1),
  stage:       z.string().optional(),
  availability: z.any().optional(),
})), async (req, res, next) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    // An admin can only add collectors to their own campaign.
    const groupId = req.user.role === 'superadmin' ? req.body.groupId : req.user.groupId;
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1 AND deleted_at IS NULL', [phoneHash]);
    if (existing.rows[0]) return res.status(409).json({ success: false, error: 'phone already registered' });

    const pinHash = await bcrypt.hash(String(req.body.pin), 12);
    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO users (id,name,phone,phone_hash,role,pin_hash,group_id,stage,availability)
       VALUES ($1,$2,$3,$4,'collector',$5,$6,$7,$8)`,
      [id, req.body.name, phone, phoneHash, pinHash, groupId,
       req.body.stage || null, req.body.availability ? JSON.stringify(req.body.availability) : null]
    );
    const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [id]);
    await audit({ actorId: req.user.sub, action: 'register_collector', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/auth/me — a user deletes their own account (App Store / Play requirement).
// Personal data is erased; past donation rows stay, attached to an anonymous
// placeholder, because they are the campaign's financial records.
router.delete('/me', authRequired, validate(z.object({
  confirm: z.literal('DELETE'),
  pin:     z.string().max(20).optional(),
})), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [req.user.sub]);
    const u = rows[0];
    if (!u) return res.status(404).json({ success: false, error: 'user not found' });
    if (u.role === 'superadmin') return res.status(403).json({ success: false, error: 'superadmin cannot self-delete' });
    if (['admin', 'collector'].includes(u.role)) {
      const ok = await bcrypt.compare(String(req.body.pin || ''), u.pin_hash || '');
      if (!ok) return res.status(403).json({ success: false, error: 'current PIN incorrect' });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET name='مستخدم محذوف', phone='', phone_hash='deleted:' || id, pin_hash=NULL,
         telegram_chat_id=NULL, availability=NULL, stage=NULL, is_anonymous=TRUE,
         deleted_at=now(), updated_at=now()
       WHERE id=$1`, [u.id]);
    await client.query('UPDATE users SET collector_id=NULL WHERE collector_id=$1', [u.id]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    await client.query("UPDATE support_messages SET from_user='مستخدم محذوف', phone=NULL WHERE from_user_id=$1", [u.id]);
    await client.query('COMMIT');
    await audit({ actorId: u.id, action: 'delete_own_account', entityType: 'user', entityId: u.id, before: { role: u.role, group_id: u.group_id }, ip: req.ip });
    res.clearCookie('waman_at', COOKIE_OPTS());
    res.clearCookie('waman_rt', { ...COOKIE_OPTS(), path: '/api/auth' });
    res.json({ success: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    next(err);
  } finally { client.release(); }
});

// POST /api/auth/change-pin
router.post('/change-pin', authRequired, validate(z.object({
  oldPin: z.string().min(4).max(20),
  newPin: strongPin,
})), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT pin_hash FROM users WHERE id=$1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    const ok = await bcrypt.compare(String(req.body.oldPin), rows[0].pin_hash || '');
    if (!ok) return res.status(403).json({ success: false, error: 'current PIN incorrect' });
    const newHash = await bcrypt.hash(String(req.body.newPin), 12);
    await pool.query('UPDATE users SET pin_hash=$1, updated_at=now() WHERE id=$2', [newHash, req.user.sub]);
    await audit({ actorId: req.user.sub, action: 'change_pin', entityType: 'user', entityId: req.user.sub, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
