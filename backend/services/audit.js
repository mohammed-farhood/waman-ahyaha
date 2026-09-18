const pool = require('../db/pool');

async function write({ actorId, action, entityType, entityId, before, after, ip, ua }) {
  await pool.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, ip, ua)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8)`,
    [actorId || null, action, entityType, entityId || null,
     before ? JSON.stringify(before) : null,
     after  ? JSON.stringify(after)  : null,
     ip || null, ua || null]
  );
}

module.exports = { write };
