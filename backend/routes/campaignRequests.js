const express = require('express');
const pool    = require('../db/pool');
const { roleRequired } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { supportMsgLimiter }          = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

router.get('/', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM campaign_requests ORDER BY created_at DESC');
    res.json({ success: true, requests: rows });
  } catch (err) { next(err); }
});

// "Start a new campaign" form on the public landing page — no login.
router.post('/', supportMsgLimiter, validate(z.object({
  payload: z.object({
    name:    z.string().trim().min(1).max(100),
    phone:   z.string().trim().min(4).max(30),
    message: z.string().max(2000).optional(),
  }),
})), async (req, res, next) => {
  try {
    const id = 'creq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query('INSERT INTO campaign_requests(id,payload) VALUES($1,$2)', [id, JSON.stringify(req.body.payload)]);
    const { rows } = await pool.query('SELECT * FROM campaign_requests WHERE id=$1', [id]);
    await audit({ action: 'create_campaign_request', entityType: 'campaign_request', entityId: id, ip: req.ip });
    res.status(201).json({ success: true, id, request: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id/resolve', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    await pool.query('UPDATE campaign_requests SET resolved=TRUE WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
