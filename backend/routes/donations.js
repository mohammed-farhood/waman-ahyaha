const express = require('express');
const pool    = require('../db/pool');
const { authRequired, roleRequired, assertGroup } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate, monthKey }   = require('../middleware/validate');
const { donationLimiter }            = require('../middleware/rateLimit');
const donations = require('../services/donations');
const { z } = require('zod');

const router = express.Router();

// Pin the requested groupId to the caller's groupId (unless superadmin).
function scopedGroupId(req) {
  if (req.user.role === 'superadmin') return req.query.groupId;
  return req.user.groupId;
}

// GET /api/donations?groupId=&month=
router.get('/', authRequired, async (req, res, next) => {
  try {
    const groupId = scopedGroupId(req);
    const { month } = req.query;
    if (!groupId || !month) return res.status(400).json({ success: false, error: 'groupId and month required' });
    const rows = await donations.getAllDonations(groupId, month);
    res.json({ success: true, donations: rows });
  } catch (err) { next(err); }
});

// GET /api/donations/stats?groupId=&month=
router.get('/stats', authRequired, async (req, res, next) => {
  try {
    const groupId = scopedGroupId(req);
    const { month } = req.query;
    if (!groupId || !month) return res.status(400).json({ success: false, error: 'groupId and month required' });
    const stats = await donations.getMonthlyStats(groupId, month);
    res.json({ success: true, stats });
  } catch (err) { next(err); }
});

// GET /api/donations/streak?groupId=&userId=
router.get('/streak', authRequired, async (req, res, next) => {
  try {
    const groupId = scopedGroupId(req);
    const { userId } = req.query;
    if (!groupId || !userId) return res.status(400).json({ success: false, error: 'groupId and userId required' });
    const streak = await donations.getDonorStreak(groupId, userId);
    res.json({ success: true, streak });
  } catch (err) { next(err); }
});

// GET /api/donations/at-risk?groupId=&collectorId=
router.get('/at-risk', authRequired, async (req, res, next) => {
  try {
    const groupId = scopedGroupId(req);
    const { collectorId } = req.query;
    if (!groupId) return res.status(400).json({ success: false, error: 'groupId required' });
    const users = await donations.getAtRiskDonors(groupId, collectorId || null);
    res.json({ success: true, users });
  } catch (err) { next(err); }
});

// GET /api/donations/history?groupId=&userId=
router.get('/history', authRequired, async (req, res, next) => {
  try {
    const groupId = scopedGroupId(req);
    const { userId } = req.query;
    if (!groupId || !userId) return res.status(400).json({ success: false, error: 'groupId and userId required' });
    const rows = await donations.getDonorHistory(groupId, userId);
    res.json({ success: true, donations: rows });
  } catch (err) { next(err); }
});

// PUT /api/donations/:groupId/:month/:userId  — upsert
router.put('/:groupId/:month/:userId',
  ...roleRequired('collector', 'admin', 'superadmin'),
  donationLimiter,
  validate(z.object({
    paid:        z.boolean(),
    amount:      z.number().int().min(0).max(100_000_000),
    collectorId: z.string().optional().nullable(),
  })),
  async (req, res, next) => {
    try {
      const { groupId, month, userId } = req.params;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ success: false, error: 'invalid month format' });
      }
      if (!assertGroup(req, res, groupId)) return;

      const { rows: cur } = await pool.query(
        'SELECT * FROM donations WHERE group_id=$1 AND month_key=$2 AND user_id=$3',
        [groupId, month, userId]
      );

      // Collector can only mark their own donors
      if (req.user.role === 'collector') {
        const { rows: donor } = await pool.query(
          'SELECT collector_id FROM users WHERE id=$1', [userId]
        );
        if (!donor[0] || donor[0].collector_id !== req.user.sub) {
          return res.status(403).json({ success: false, error: 'forbidden: not your donor' });
        }
      }

      const row = await donations.upsertDonation({
        groupId, monthKey: month, userId,
        paid:        req.body.paid,
        amount:      req.body.amount,
        collectorId: req.body.collectorId || req.user.sub,
      });

      await audit({
        actorId: req.user.sub,
        action: req.body.paid ? 'mark_paid' : 'mark_unpaid',
        entityType: 'donation',
        entityId: `${groupId}/${month}/${userId}`,
        before: cur[0] || null,
        after: row,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });

      res.json({ success: true, donation: row });
    } catch (err) { next(err); }
  }
);

module.exports = router;
