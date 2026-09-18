const express = require('express');
const pool    = require('../db/pool');
const { authRequired, roleRequired } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { supportMsgLimiter }          = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

router.get('/', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 200');
    res.json({ success: true, messages: rows });
  } catch (err) { next(err); }
});

router.post('/', authRequired, supportMsgLimiter, validate(z.object({
  subject: z.string().max(120).optional(),
  body:    z.string().min(1).max(2000),
})), async (req, res, next) => {
  try {
    const id = 'sup_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const { rows: u } = await pool.query('SELECT name, phone FROM users WHERE id=$1', [req.user.sub]);
    await pool.query(
      'INSERT INTO support_messages(id,from_user,phone,subject,body) VALUES($1,$2,$3,$4,$5)',
      [id, u[0]?.name || null, u[0]?.phone || null, req.body.subject || null, req.body.body]
    );
    await audit({ actorId: req.user.sub, action: 'send_support_message', entityType: 'support_message', entityId: id, ip: req.ip });
    res.status(201).json({ success: true, id });
  } catch (err) { next(err); }
});

router.delete('/:id', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM support_messages WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch('/:id/resolve', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    await pool.query('UPDATE support_messages SET resolved=TRUE WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
