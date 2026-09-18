const express = require('express');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { roleRequired, accessToken }  = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { supportMsgLimiter }          = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

// The support form is also shown to visitors, so login is optional here.
function optionalUser(req) {
  const t = accessToken(req);
  if (!t) return null;
  try { return jwt.verify(t, process.env.JWT_SECRET); } catch { return null; }
}

// Superadmin sees every message; an admin only their own campaign's.
function scope(req) {
  if (req.user.role === 'superadmin') return { where: '', params: [] };
  return { where: 'WHERE group_id=$1', params: [req.user.groupId] };
}

router.get('/', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { where, params } = scope(req);
    const { rows } = await pool.query(`SELECT * FROM support_messages ${where} ORDER BY created_at DESC LIMIT 200`, params);
    res.json({ success: true, messages: rows });
  } catch (err) { next(err); }
});

router.post('/', supportMsgLimiter, validate(z.object({
  subject:    z.string().max(120).optional(),
  body:       z.string().trim().min(1).max(2000),
  senderName: z.string().trim().max(100).optional(),
})), async (req, res, next) => {
  try {
    const user = optionalUser(req);
    let name = req.body.senderName || 'زائر', phone = null, groupId = null;
    if (user) {
      const { rows: u } = await pool.query('SELECT name, phone, group_id FROM users WHERE id=$1', [user.sub]);
      if (u[0]) { name = u[0].name; phone = u[0].phone; groupId = u[0].group_id; }
    }
    const id = 'sup_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      'INSERT INTO support_messages(id,from_user,from_user_id,group_id,phone,subject,body) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, name, user?.sub || null, groupId, phone, req.body.subject || null, req.body.body]
    );
    const { rows } = await pool.query('SELECT * FROM support_messages WHERE id=$1', [id]);
    await audit({ actorId: user?.sub || null, action: 'send_support_message', entityType: 'support_message', entityId: id, ip: req.ip });
    res.status(201).json({ success: true, id, message: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { where, params } = scope(req);
    params.push(req.params.id);
    const cond = where ? `${where} AND id=$${params.length}` : `WHERE id=$${params.length}`;
    const r = await pool.query(`DELETE FROM support_messages ${cond}`, params);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'not found' });
    await audit({ actorId: req.user.sub, action: 'delete_support_message', entityType: 'support_message', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch('/:id/resolve', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { where, params } = scope(req);
    params.push(req.params.id);
    const cond = where ? `${where} AND id=$${params.length}` : `WHERE id=$${params.length}`;
    const r = await pool.query(`UPDATE support_messages SET resolved=TRUE ${cond}`, params);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
