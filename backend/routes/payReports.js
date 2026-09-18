const express = require('express');
const pool    = require('../db/pool');
const { authRequired, roleRequired, assertGroup } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate, monthKey }   = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

router.get('/', authRequired, async (req, res, next) => {
  try {
    // Non-superadmin pinned to own group; superadmin may pass any groupId or none.
    const groupId = req.user.role === 'superadmin' ? req.query.groupId : req.user.groupId;
    const params = [];
    let where = '1=1';
    if (groupId) { params.push(groupId); where = `group_id=$${params.length}`; }
    const { rows } = await pool.query(
      `SELECT * FROM pay_reports WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params
    );
    res.json({ success: true, reports: rows });
  } catch (err) { next(err); }
});

router.post('/', authRequired, validate(z.object({
  groupId:    z.string().min(1),
  donorId:    z.string().min(1),
  monthKey:   z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  amount:     z.number().int().min(0).optional(),
  note:       z.string().max(500).optional(),
})), async (req, res, next) => {
  try {
    const b = req.body;
    if (!assertGroup(req, res, b.groupId)) return;
    // Verify the donor belongs to the asserted group, so callers can't pollute another group's records.
    const { rows: donor } = await pool.query(
      'SELECT group_id FROM users WHERE id=$1 AND deleted_at IS NULL',
      [b.donorId]
    );
    if (!donor[0] || donor[0].group_id !== b.groupId) {
      return res.status(403).json({ success: false, error: 'donor not in this group' });
    }
    const id = 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      'INSERT INTO pay_reports(id,group_id,reporter_id,donor_id,month_key,amount,note) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, b.groupId, req.user.sub, b.donorId, b.monthKey, b.amount || null, b.note || null]
    );
    await audit({ actorId: req.user.sub, action: 'create_pay_report', entityType: 'pay_report', entityId: id, ip: req.ip });
    res.status(201).json({ success: true, id });
  } catch (err) { next(err); }
});

router.post('/:id/acknowledge', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query('SELECT group_id FROM pay_reports WHERE id=$1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });
    if (!assertGroup(req, res, cur[0].group_id)) return;
    const { rows } = await pool.query(
      'UPDATE pay_reports SET acknowledged=TRUE, acknowledged_at=now() WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    await audit({ actorId: req.user.sub, action: 'acknowledge_pay_report', entityType: 'pay_report', entityId: req.params.id, ip: req.ip });
    res.json({ success: true, report: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
