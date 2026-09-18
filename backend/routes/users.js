const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authRequired, roleRequired, selfOr, assertGroup } = require('../middleware/auth');
const { write: audit } = require('../services/audit');
const { normalize, hmac } = require('../services/phone');
const { body: validate, phoneRaw } = require('../middleware/validate');
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

    const { rows } = await pool.query(
      `SELECT ${SAFE_COLS} FROM users WHERE ${where} ORDER BY join_date DESC`,
      params
    );
    res.json({ success: true, users: rows });
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
  pin:         z.string().optional(),
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
    const phone = normalize(req.body.phone);
    const phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    const existing = await pool.query('SELECT id FROM users WHERE phone_hash=$1', [phoneHash]);
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

// POST /api/users/:id/telegram-link
router.post('/:id/telegram-link', ...selfOr('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ success: false, error: 'chatId required' });
    await pool.query('UPDATE users SET telegram_chat_id=$1, updated_at=now() WHERE id=$2', [chatId, req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/users/:id/telegram-unlink
router.post('/:id/telegram-unlink', ...selfOr('admin', 'superadmin'), async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET telegram_chat_id=NULL, updated_at=now() WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'telegram_unlink', entityType: 'user', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
