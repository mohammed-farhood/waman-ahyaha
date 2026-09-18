#!/usr/bin/env node
/**
 * Wipe all application data — keep schema, migrations, settings, and superadmins.
 *
 * Usage:
 *   node scripts/wipe-data.js --yes              # wipe, keep superadmins
 *   node scripts/wipe-data.js --yes --all-users  # also remove superadmins (factory reset)
 *   node scripts/wipe-data.js --dry-run          # show counts only, no writes
 *
 * Requires --yes (or --dry-run) so it cannot fire by accident.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db/pool');

const args      = process.argv.slice(2);
const dryRun    = args.includes('--dry-run');
const confirmed = args.includes('--yes');
const allUsers  = args.includes('--all-users');

if (!confirmed && !dryRun) {
  console.error('Refusing to run without --yes (or --dry-run).');
  console.error('Usage: node scripts/wipe-data.js --yes [--all-users]');
  process.exit(1);
}

// Tables to empty, in FK-safe order (children before parents).
// schema_migrations and settings are intentionally excluded.
const DATA_TABLES = [
  'sessions',
  'auth_codes',
  'audit_logs',
  'pay_reports',
  'support_messages',
  'campaign_requests',
  'announcements',
  'donations',
  'orphans',
  // users + groups handled below (users needs superadmin-preserving DELETE)
];

async function counts(client) {
  const out = {};
  for (const t of [...DATA_TABLES, 'users', 'groups']) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

async function main() {
  const client = await pool.connect();
  try {
    const before = await counts(client);
    console.log('[wipe] Row counts BEFORE:', before);

    if (dryRun) {
      console.log('[wipe] --dry-run: no changes made.');
      return;
    }

    await client.query('BEGIN');

    for (const t of DATA_TABLES) {
      await client.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    }

    if (allUsers) {
      // Factory reset: drop every user (including superadmins) and every group.
      await client.query('TRUNCATE TABLE users, groups RESTART IDENTITY CASCADE');
    } else {
      // Preserve superadmins; remove their group affiliation since groups are wiped.
      await client.query(`DELETE FROM users WHERE role <> 'superadmin'`);
      await client.query(`UPDATE users SET group_id = NULL, collector_id = NULL WHERE role = 'superadmin'`);
      await client.query('TRUNCATE TABLE groups RESTART IDENTITY CASCADE');
    }

    await client.query('COMMIT');

    const after = await counts(client);
    console.log('[wipe] Row counts AFTER :', after);
    console.log('[wipe] ✓ Done.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[wipe] Failed — rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
