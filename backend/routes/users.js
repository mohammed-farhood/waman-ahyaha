const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authRequired, roleRequired, selfOr, assertGroup } = require('../middleware/auth');
const { write: audit } = require('../services/audit');
const { normalize, hmac } = require('../services/phone');
const { body: validate, phoneRaw, isWeakPin } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const SAFE_COLS = 'id,name,phone,role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id,created_at,updated_at';

// GET /api/users?groupId=&collectorId=&role=
router.get('/', authRequired, async (req, res, next) => {
  try {
    const { groupId, collectorId, role } = req.query;
    const u = req.user;

    let where = 'deleted_at IS NULL';
    const params = [];

    if (u.role === 'superadmin') {
      if (groupId) { params.push(groupId); where += ` AND group_id=$${params.length}`; }
    } else {
      params.push(u.groupId);
      where += ` AND group_id=$${params.length}`;
    }
    if (collectorId) { params.push(collectorId); where += ` AND collector_id=$${params.length}`; }
    if (role)        { params.push(role);        where += ` AND role=$${params.length}`; }

    // Donors (anyone can self-register as one) must not be able to harvest the
    // campaign's phone numbers: they get phones of staff only, anonymous donors'
    // names are masked, and Telegram ids are only returned for themselves.
    let cols = SAFE_COLS;
    if (u.role === 'donor') {
      params.push(u.sub);
      const me = `$${params.length}`;
      cols = `id,
        CASE WHEN is_anonymous AND id <> ${me} THEN 'فاعل خير' ELSE name END AS name,
        CASE WHEN id = ${me} OR role IN ('collector','admin') THEN phone END AS phone,
        role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,
        CASE WHEN id = ${me} THEN telegram_chat_id END AS telegram_chat_id,
        created_at,updated_at`;
    }
    const { rows } = await pool.query(
      `SELECT ${cols} FROM users WHERE ${where} ORDER BY join_date DESC`,
      params
    );
    res.json({ success: true, users: rows });
  } catch (err) { next(err); }
});

// POST /api/users/donors  (collector/admin/superadmin add a donor to their campaign)
// If the phone already belongs to a donor of the same campaign, that donor is
// linked to the collector instead ({ linked: true }).
router.post('/donors', ...roleRequired('collector', 'admin', 'superadmin'), validate(z.object({
  name:        z.string().min(2).max(100),
  phone:       phoneRaw,
  groupId:     z.string().optional(),
  collectorId: z.string().nullable().optional(),
  amount:      z.number().int().min(0).max(100_000_000).optional(),
  isAnonymous: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const me = req.user;
    const groupId = me.role === 'superadmin' ? req.body.groupId : me.groupId;
    if (!groupId) return res.status(400).json({ success: false, error: 'groupId required' });
    const { rows: grp } = await pool.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL', [groupId]);
    if (!grp[0]) return res.status(400).json({ success: false, error: 'unknown campaign' });

    // A collector always adds to their own list; admins may pick a collector of this campaign.
    let collectorId = me.role === 'collector' ? me.sub : (req.body.collectorId || null);
    if (collectorId && me.role !== 'collector') {
      const { rows: col } = await pool.query(
        "SELECT id FROM users WHERE id=$1 AND group_id=$2 AND role='collector' AND deleted_at IS NULL",
        [collectorId, groupId]
      );
      if (!col[0]) return res.status(400).json({ success: false, error: 'collector not in this campaign' });
    }

    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    const { rows: ex } = await pool.query('SELECT * FROM users WHERE phone_hash=$1 AND deleted_at IS NULL', [phoneHash]);
    if (ex[0]) {
      if (ex[0].role !== 'donor' || ex[0].group_id !== groupId) {
        return res.status(409).json({ success: false, error: 'phone already registered' });
      }
      if (collectorId) {
        await pool.query('UPDATE users SET collector_id=$1, updated_at=now() WHERE id=$2', [collectorId, ex[0].id]);
      }
      const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [ex[0].id]);
      await audit({ actorId: me.sub, action: 'link_donor', entityType: 'user', entityId: ex[0].id, before: { collector_id: ex[0].collector_id }, after: { collector_id: rows[0].collector_id }, ip: req.ip });
      return res.json({ success: true, linked: true, user: rows[0] });
    }

    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO users(id,name,phone,phone_hash,role,group_id,collector_id,amount,is_anonymous)
       VALUES($1,$2,$3,$4,'donor',$5,$6,$7,$8)`,
      [id, req.body.name, phone, phoneHash, groupId, collectorId, req.body.amount || 0, !!req.body.isAnonymous]
    );
    const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [id]);
    await audit({ actorId: me.sub, action: 'create_donor', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, linked: false, user: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/users/:id
router.get('/:id', ...selfOr('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SAFE_COLS} FROM users WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    // Same-group scope for non-superadmin admins (self path already allowed by selfOr).
    if (req.user.sub !== rows[0].id && !assertGroup(req, res, rows[0].group_id)) return;
    res.json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/users  (admin/superadmin create any user role)
router.post('/', ...roleRequired('admin', 'superadmin'), validate(z.object({
  name:        z.string().min(2).max(100),
  phone:       phoneRaw,
  role:        z.enum(['admin', 'collector', 'donor']),
  pin:         z.string().max(20).optional(),
  groupId:     z.string().optional(),
  collectorId: z.string().optional(),
  amount:      z.number().int().min(0).optional(),
  isAnonymous: z.boolean().optional(),
  stage:       z.string().optional(),
  availability: z.any().optional(),
})), async (req, res, next) => {
  try {
    // Non-superadmin admins cannot create another admin (privilege escalation).
    if (req.body.role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'only superadmin can create admins' });
    }
    if (['admin', 'collector'].includes(req.body.role)) {
      if (!req.body.pin || req.body.pin.length < 4) return res.status(400).json({ success: false, error: 'pin: Required' });
      if (isWeakPin(req.body.pin)) return res.status(400).json({ success: false, error: 'PIN too weak' });
    }
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1 AND deleted_at IS NULL', [phoneHash]);
    if (existing.rows[0]) return res.status(409).json({ success: false, error: 'phone already registered' });

    let pinHash = null;
    if (['admin', 'collector'].includes(req.body.role) && req.body.pin) {
      pinHash = await bcrypt.hash(String(req.body.pin), 12);
    }
    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const groupId = req.user.role === 'superadmin' ? (req.body.groupId || null) : req.user.groupId;

    await pool.query(
      `INSERT INTO users(id,name,phone,phone_hash,role,pin_hash,group_id,collector_id,amount,is_anonymous,stage,availability)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, req.body.name, phone, phoneHash, req.body.role, pinHash, groupId,
       req.body.collectorId || null, req.body.amount || 0, !!req.body.isAnonymous,
       req.body.stage || null, req.body.availability ? JSON.stringify(req.body.availability) : null]
    );
    const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [id]);
    await audit({ actorId: req.user.sub, action: 'create_user', entityType: 'user', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/users/:id
router.put('/:id', ...selfOr('admin', 'superadmin'), validate(z.object({
  name:        z.string().min(2).max(100).optional(),
  amount:      z.number().int().min(0).max(100_000_000).nullable().optional(),
  stage:       z.string().nullable().optional(),
  availability: z.any().optional(),
  collectorId: z.string().nullable().optional(),
  isAnonymous: z.boolean().nullable().optional(),
}).passthrough()), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });

    // Same-group scope for non-superadmin admins (selfOr already allows self path).
    if (req.user.sub !== cur[0].id && !assertGroup(req, res, cur[0].group_id)) return;
    // Admin cannot edit other admins / superadmins.
    if (req.user.role === 'admin' && req.user.sub !== cur[0].id
        && ['admin','superadmin'].includes(cur[0].role)) {
      return res.status(403).json({ success: false, error: 'cannot edit admin/superadmin' });
    }

    // Self can only change non-privileged fields
    const isSelf = req.user.sub === req.params.id && !['admin','superadmin'].includes(req.user.role);
    const allowed = isSelf
      ? ['name', 'stage', 'availability', 'isAnonymous']
      : ['name', 'amount', 'stage', 'availability', 'collectorId', 'isAnonymous'];

    const sets = []; const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const col = key === 'isAnonymous' ? 'is_anonymous'
                  : key === 'collectorId' ? 'collector_id'
                  : key;
        params.push(key === 'availability' ? JSON.stringify(req.body[key]) : req.body[key]);
        sets.push(`${col}=$${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'nothing to update' });
    params.push(req.params.id);
    sets.push('updated_at=now()');

    await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    const { rows } = await pool.query(`SELECT ${SAFE_COLS} FROM users WHERE id=$1`, [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'update_user', entityType: 'user', entityId: req.params.id, before: cur[0], after: rows[0], ip: req.ip });
    res.json({ success: true, user: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query(
      'SELECT id, role, group_id FROM users WHERE id=$1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });
    // Same-group scope for non-superadmin admins.
    if (!assertGroup(req, res, cur[0].group_id)) return;
    // Admin cannot delete superadmins or other admins; only superadmin can.
    if (req.user.role === 'admin' && ['admin','superadmin'].includes(cur[0].role)) {
      return res.status(403).json({ success: false, error: 'cannot delete admin/superadmin' });
    }
    // Self-delete guard for superadmin (avoid platform lock-out).
    if (cur[0].role === 'superadmin' && cur[0].id === req.user.sub) {
      return res.status(403).json({ success: false, error: 'superadmin cannot self-delete' });
    }
    await pool.query('UPDATE users SET deleted_at=now() WHERE id=$1', [cur[0].id]);
    await audit({ actorId: req.user.sub, action: 'delete_user', entityType: 'user', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Admin acting on someone else must stay inside their own campaign.
async function sameGroupTarget(req, res) {
  if (req.user.sub === req.params.id || req.user.role === 'superadmin') return true;
  const { rows } = await pool.query('SELECT group_id FROM users WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!rows[0]) { res.status(404).json({ success: false, error: 'not found' }); return false; }
  return assertGroup(req, res, rows[0].group_id);
}

// POST /api/users/:id/telegram-link  { code }
// The chat id comes from the auth code the bot marked 'linked', never from the
// client, so nobody can point an account at someone else's Telegram chat.
router.post('/:id/telegram-link', ...selfOr('admin', 'superadmin'), validate(z.object({
  code: z.string().min(6).max(40),
})), async (req, res, next) => {
  try {
    if (!(await sameGroupTarget(req, res))) return;
    const { rows } = await pool.query(
      "DELETE FROM auth_codes WHERE code=$1 AND status='linked' RETURNING chat_id", [req.body.code]
    );
    if (!rows[0]) return res.status(400).json({ success: false, error: 'code not linked' });
    await pool.query('UPDATE users SET telegram_chat_id=$1, updated_at=now() WHERE id=$2', [rows[0].chat_id, req.params.id]);
    await audit({ actorId: req.user.sub, action: 'telegram_link', entityType: 'user', entityId: req.params.id, ip: req.ip });
    res.json({ success: true, chatId: String(rows[0].chat_id) });
  } catch (err) { next(err); }
});

// POST /api/users/:id/telegram-unlink
router.post('/:id/telegram-unlink', ...selfOr('admin', 'superadmin'), async (req, res, next) => {
  try {
    if (!(await sameGroupTarget(req, res))) return;
    await pool.query('UPDATE users SET telegram_chat_id=NULL, updated_at=now() WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'telegram_unlink', entityType: 'user', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
