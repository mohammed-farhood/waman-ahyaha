const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { normalize, hmac } = require('../services/phone');
const { write: audit }    = require('../services/audit');
const { authRequired }    = require('../middleware/auth');
const { body: validate, phoneRaw, pinRaw } = require('../middleware/validate');
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

    const client = await pool.connect();
    let refreshRaw;
    try {
      await client.query('BEGIN');
      refreshRaw = await signRefresh(user.id, req.ip, req.headers['user-agent'], client);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const accessToken = signAccess(user);
    const refreshHash = crypto.createHash('sha256').update(refreshRaw).digest('hex');

    res.cookie('alayn_at', accessToken, { ...COOKIE_OPTS(), maxAge: 15 * 60 * 1000 });
    res.cookie('alayn_rt', refreshRaw,  { ...COOKIE_OPTS(), maxAge: 30 * 24 * 3600 * 1000, path: '/api/auth' });

    const { pin_hash, phone_hash, ...safeUser } = user;
    await audit({ actorId: user.id, action: 'login', entityType: 'user', entityId: user.id, ip: req.ip, ua: req.headers['user-agent'] });

    res.json({ success: true, user: safeUser });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.alayn_rt;
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
    res.cookie('alayn_at', accessToken, { ...COOKIE_OPTS(), maxAge: 15 * 60 * 1000 });
    res.cookie('alayn_rt', newRaw, { ...COOKIE_OPTS(), maxAge: 30 * 24 * 3600 * 1000, path: '/api/auth' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', authRequired, async (req, res, next) => {
  try {
    const raw = req.cookies?.alayn_rt;
    if (raw) {
      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      await pool.query('DELETE FROM sessions WHERE refresh_token_hash=$1', [hash]);
    }
    res.clearCookie('alayn_at');
    res.clearCookie('alayn_rt', { path: '/api/auth' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,phone,role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id,created_at FROM users WHERE id=$1 AND deleted_at IS NULL',
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

    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1', [phoneHash]);
    if (existing.rows[0]) return res.status(409).json({ success: false, error: 'phone already registered' });

    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO users (id,name,phone,phone_hash,role,group_id,collector_id,amount,is_anonymous)
       VALUES ($1,$2,$3,$4,'donor',$5,$6,$7,$8)`,
      [id, req.body.name, phone, phoneHash, req.body.groupId, req.body.collectorId || null,
       req.body.amount || 0, !!req.body.isAnonymous]
    );
    const { rows } = await pool.query('SELECT id,name,phone,role,group_id,join_date FROM users WHERE id=$1', [id]);
    await audit({ action: 'register_donor', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/auth/register-collector  (admin/superadmin only)
router.post('/register-collector', authRequired, validate(z.object({
  name:        z.string().min(2).max(100),
  phone:       phoneRaw,
  pin:         pinRaw,
  groupId:     z.string().min(1),
  stage:       z.string().optional(),
  availability: z.any().optional(),
})), async (req, res, next) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1', [phoneHash]);
    if (existing.rows[0]) return res.status(409).json({ success: false, error: 'phone already registered' });

    const pinHash = await bcrypt.hash(String(req.body.pin), 12);
    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO users (id,name,phone,phone_hash,role,pin_hash,group_id,stage,availability)
       VALUES ($1,$2,$3,$4,'collector',$5,$6,$7,$8)`,
      [id, req.body.name, phone, phoneHash, pinHash, req.body.groupId,
       req.body.stage || null, req.body.availability ? JSON.stringify(req.body.availability) : null]
    );
    const { rows } = await pool.query('SELECT id,name,phone,role,group_id,stage FROM users WHERE id=$1', [id]);
    await audit({ actorId: req.user.sub, action: 'register_collector', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/auth/change-pin
router.post('/change-pin', authRequired, validate(z.object({
  oldPin: z.string().min(4).max(20),
  newPin: z.string().min(4).max(20),
})), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT pin_hash FROM users WHERE id=$1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    const ok = await bcrypt.compare(String(req.body.oldPin), rows[0].pin_hash || '');
    if (!ok) return res.status(401).json({ success: false, error: 'current PIN incorrect' });
    const newHash = await bcrypt.hash(String(req.body.newPin), 12);
    await pool.query('UPDATE users SET pin_hash=$1, updated_at=now() WHERE id=$2', [newHash, req.user.sub]);
    await audit({ actorId: req.user.sub, action: 'change_pin', entityType: 'user', entityId: req.user.sub, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
