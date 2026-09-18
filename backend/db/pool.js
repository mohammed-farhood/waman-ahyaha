const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings. By default pg builds a JS Date at
// local midnight, which serialises to the previous day on any server east of UTC.
types.setTypeParser(1082, v => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[PG] Unexpected pool error:', err.message);
});

module.exports = pool;
