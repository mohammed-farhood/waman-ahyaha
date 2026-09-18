const express = require('express');
const pool    = require('../db/pool');
const { roleRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit-logs?actorId=&entityType=&entityId=&limit=&offset=
router.get('/', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const { actorId, entityType, entityId, limit = 100, offset = 0 } = req.query;
    const params = [];
    const conditions = [];

    if (actorId)    { params.push(actorId);    conditions.push(`actor_id=$${params.length}`); }
    if (entityType) { params.push(entityType); conditions.push(`entity_type=$${params.length}`); }
    if (entityId)   { params.push(entityId);   conditions.push(`entity_id=$${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(Number(limit), 500));
    params.push(Math.max(Number(offset), 0));

    const { rows } = await pool.query(
      `SELECT id,actor_id,action,entity_type,entity_id,before,after,ip,ua,created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, logs: rows });
  } catch (err) { next(err); }
});

module.exports = router;
