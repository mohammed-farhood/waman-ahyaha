const pool = require('../db/pool');
const { monthKey, addMonths } = require('./month');

const DONOR_COLS = 'u.id,u.name,u.phone,u.role,u.group_id,u.collector_id,u.amount,u.is_anonymous,u.join_date,u.stage,u.telegram_chat_id';

async function getMonthlyStats(groupId, monthKey) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(u.id)::int                                         AS total_donors,
       COUNT(d.user_id) FILTER (WHERE d.paid)::int             AS paid_count,
       COUNT(u.id) FILTER (WHERE d.paid IS NOT TRUE)::int       AS unpaid_count,
       COALESCE(SUM(d.amount) FILTER (WHERE d.paid), 0)::int   AS total_amount,
       COALESCE(SUM(u.amount), 0)::int                         AS total_expected
     FROM users u
     LEFT JOIN donations d
       ON d.user_id = u.id AND d.group_id = $1 AND d.month_key = $2
     WHERE u.group_id = $1 AND u.role = 'donor' AND u.deleted_at IS NULL`,
    [groupId, monthKey]
  );
  const row = rows[0];
  const rate = row.total_expected > 0
    ? Math.round((row.total_amount / row.total_expected) * 100)
    : 0;
  return { ...row, completion_rate: rate };
}

async function getDonorStreak(groupId, userId) {
  const { rows } = await pool.query(
    `SELECT month_key, paid
     FROM donations
     WHERE group_id = $1 AND user_id = $2
     ORDER BY month_key DESC`,
    [groupId, userId]
  );
  let streak = 0;
  for (const r of rows) {
    if (r.paid) streak++;
    else break;
  }
  return streak;
}

async function getAtRiskDonors(groupId, collectorId = null) {
  const cur  = monthKey();
  const day  = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', day: 'numeric' }).format(new Date()));
  if (day <= 5) return [];
  const prev = addMonths(cur, -1);

  const params = [groupId, prev, cur];
  let extra = '';
  if (collectorId) { extra = ' AND u.collector_id = $4'; params.push(collectorId); }

  const { rows } = await pool.query(
    `SELECT ${DONOR_COLS}
     FROM users u
     JOIN donations dp ON dp.user_id=u.id AND dp.group_id=$1 AND dp.month_key=$2 AND dp.paid=TRUE
     LEFT JOIN donations dc ON dc.user_id=u.id AND dc.group_id=$1 AND dc.month_key=$3
     WHERE u.group_id=$1 AND u.role='donor' AND u.deleted_at IS NULL
       AND (dc.paid IS NULL OR dc.paid=FALSE)${extra}`,
    params
  );
  return rows;
}

async function getAllDonations(groupId, monthKey) {
  const { rows } = await pool.query(
    `SELECT group_id, month_key, user_id, paid, amount, paid_date, collector_id, updated_at
     FROM donations
     WHERE group_id = $1 AND month_key = $2`,
    [groupId, monthKey]
  );
  return rows;
}

async function getDonationsSince(fromMonth, groupId = null) {
  const params = [fromMonth];
  let where = 'month_key >= $1';
  if (groupId) { params.push(groupId); where += ' AND group_id = $2'; }
  const { rows } = await pool.query(
    `SELECT group_id, month_key, user_id, paid, amount, paid_date, collector_id, updated_at
     FROM donations WHERE ${where}`,
    params
  );
  return rows;
}

async function getDonorHistory(groupId, userId) {
  const { rows } = await pool.query(
    `SELECT group_id, month_key, user_id, paid, amount, paid_date, collector_id, updated_at
     FROM donations
     WHERE group_id = $1 AND user_id = $2
     ORDER BY month_key DESC`,
    [groupId, userId]
  );
  return rows;
}

async function upsertDonation({ groupId, monthKey, userId, paid, amount, collectorId }) {
  const { rows } = await pool.query(
    `INSERT INTO donations (group_id, month_key, user_id, paid, amount, paid_date, collector_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (group_id, month_key, user_id) DO UPDATE
       SET paid = EXCLUDED.paid,
           amount = EXCLUDED.amount,
           paid_date = CASE WHEN EXCLUDED.paid THEN now() ELSE NULL END,
           collector_id = EXCLUDED.collector_id,
           updated_at = now()
     RETURNING *`,
    [groupId, monthKey, userId, !!paid, amount || 0,
     paid ? new Date().toISOString() : null, collectorId || null]
  );
  return rows[0];
}

module.exports = { getMonthlyStats, getDonorStreak, getAtRiskDonors, getAllDonations, getDonationsSince, getDonorHistory, upsertDonation };
