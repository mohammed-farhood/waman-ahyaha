const express = require('express');
const pool    = require('../db/pool');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/leaderboard?month=YYYY-MM
router.get('/', authRequired, async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const { rows } = await pool.query(
      `SELECT
         g.id, g.name, g.university, g.icon,
         g.orphans_sponsored, g.cost_per_orphan, g.monthly_goal,
         COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'donor')::int         AS total_donors,
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
       LEFT JOIN users u  ON u.group_id = g.id AND u.deleted_at IS NULL
       LEFT JOIN donations d ON d.group_id = g.id AND d.user_id = u.id
       WHERE g.deleted_at IS NULL
       GROUP BY g.id
       ORDER BY completion_rate DESC, month_paid DESC`,
      [month]
    );
    res.json({ success: true, leaderboard: rows });
  } catch (err) { next(err); }
});

module.exports = router;
