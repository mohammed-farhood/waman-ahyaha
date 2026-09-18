const express = require('express');
const pool    = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { monthKey, MONTH_RE } = require('../services/month');

const router = express.Router();

// GET /api/leaderboard?month=YYYY-MM
router.get('/', authRequired, async (req, res, next) => {
  try {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : monthKey();

    const { rows } = await pool.query(
      `SELECT
         g.id, g.name, g.university, g.icon,
         g.orphans_sponsored, g.cost_per_orphan, g.monthly_goal,
         (SELECT COUNT(*) FROM users u
            WHERE u.group_id = g.id AND u.role = 'donor' AND u.deleted_at IS NULL)::int AS total_donors,
         COALESCE(SUM(d.amount) FILTER (WHERE d.paid AND d.month_key=$1), 0)::int AS month_paid,
         COALESCE(SUM(d.amount) FILTER (WHERE d.paid), 0)::int              AS all_time_total,
         CASE WHEN g.monthly_goal > 0
           THEN ROUND(
             COALESCE(SUM(d.amount) FILTER (WHERE d.paid AND d.month_key=$1), 0)
             * 100.0 / g.monthly_goal
           )
           ELSE 0
         END::int AS completion_rate
       FROM groups g
       LEFT JOIN donations d ON d.group_id = g.id
       WHERE g.deleted_at IS NULL
       GROUP BY g.id
       ORDER BY completion_rate DESC, month_paid DESC`,
      [month]
    );
    res.json({ success: true, leaderboard: rows });
  } catch (err) { next(err); }
});

module.exports = router;
