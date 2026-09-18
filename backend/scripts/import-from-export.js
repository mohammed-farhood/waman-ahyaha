#!/usr/bin/env node
/**
 * One-time migration: import data exported from localStorage via DB.exportAll().
 *
 * Usage:
 *   node scripts/import-from-export.js path/to/snapshot.json [--dry-run]
 *
 * The script:
 *   - Normalises phone numbers to E.164
 *   - bcrypt-hashes any plaintext PIN found
 *   - Encrypts orphan PII with PG_ENC_KEY
 *   - Wraps everything in a single transaction (safe to re-run: ON CONFLICT DO NOTHING)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { normalize, hmac } = require('../services/phone');

const file   = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!file) {
  console.error('Usage: node import-from-export.js <snapshot.json> [--dry-run]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const ENC_KEY = process.env.PG_ENC_KEY;

async function main() {
  const stats = { groups: 0, users: 0, donations: 0, announcements: 0, orphans: 0, skipped: 0 };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Groups ────────────────────────────────────────────────────
    for (const g of Object.values(data.groups || {})) {
      const sponsored = g.orphansSponsored ?? g.orphans_sponsored ?? 0;
      const cost      = g.costPerOrphan    ?? g.cost_per_orphan   ?? 25000;
      const pledge    = g.defaultPledge    ?? g.default_pledge    ?? 5000;
      await client.query(
        `INSERT INTO groups(id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [g.id, g.name, g.university||null, g.icon||null,
         sponsored, cost, sponsored*cost, pledge,
         g.createdAt||g.created_at||new Date()]
      );
      stats.groups++;
    }

    // ── Users ────────────────────────────────────────────────────
    const userList = Array.isArray(data.users)
      ? data.users
      : Object.values(data.users || {});

    for (const u of userList) {
      let phone, phoneHash;
      try {
        phone     = normalize(u.phone);
        phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
      } catch {
        console.warn(`[SKIP] user ${u.id} — invalid phone: ${u.phone}`);
        stats.skipped++;
        continue;
      }

      let pinHash = u.pin_hash || null;
      if (!pinHash && u.pin) {
        pinHash = await bcrypt.hash(String(u.pin), 12);
      }

      await client.query(
        `INSERT INTO users(id,name,phone,phone_hash,role,pin_hash,group_id,collector_id,amount,
           is_anonymous,join_date,stage,availability,telegram_chat_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.name, phone, phoneHash,
         u.role || 'donor', pinHash,
         u.groupId||u.group_id||null, u.collectorId||u.collector_id||null,
         u.amount||0, !!u.isAnonymous||!!u.is_anonymous,
         u.joinDate||u.join_date||new Date(),
         u.stage||null,
         u.availability ? JSON.stringify(u.availability) : null,
         u.telegramChatId||u.telegram_chat_id||null]
      );
      stats.users++;
    }

    // ── Donations ────────────────────────────────────────────────
    const donationsArr = Array.isArray(data.donations)
      ? data.donations
      : Object.entries(data.donations || {}).flatMap(([groupId, months]) =>
          Object.entries(months).flatMap(([monthKey, donors]) =>
            Object.entries(donors).map(([userId, d]) => ({
              group_id: groupId, month_key: monthKey, user_id: userId, ...d
            }))
          )
        );

    for (const d of donationsArr) {
      await client.query(
        `INSERT INTO donations(group_id,month_key,user_id,paid,amount,paid_date,collector_id)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [d.group_id||d.groupId, d.month_key||d.monthKey, d.user_id||d.userId,
         !!d.paid, d.amount||0, d.date||d.paid_date||null, d.collectorId||d.collector_id||null]
      );
      stats.donations++;
    }

    // ── Announcements ─────────────────────────────────────────────
    for (const a of (data.announcements || [])) {
      await client.query(
        `INSERT INTO announcements(id,group_id,author_id,author_name,type,title,content,posted_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.groupId||a.group_id, a.authorId||a.author_id||null,
         a.authorName||a.author_name||'', a.type||'news', a.title, a.content,
         a.date||a.posted_at||new Date()]
      );
      stats.announcements++;
    }

    // ── Orphans ───────────────────────────────────────────────────
    for (const o of (data.orphans || [])) {
      await client.query(
        `INSERT INTO orphans(id,group_id,name_enc,code,province,type,amount,birth_date_enc,status,notes_enc)
         VALUES($1,$2,pgp_sym_encrypt($3,$10),$4,$5,$6,$7,pgp_sym_encrypt($8,$10),$9,pgp_sym_encrypt($11,$10))
         ON CONFLICT (id) DO NOTHING`,
        [o.id, o.groupId||o.group_id, o.name||'',
         o.code||null, o.province||null, o.type||null, o.amount||null,
         o.birthDate||o.birth_date||null, o.status||null,
         ENC_KEY, o.notes||null]
      );
      stats.orphans++;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('[dry-run] Would import:', stats);
    } else {
      await client.query('COMMIT');
      console.log('[import] ✓ Imported:', stats);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[import] Failed — rolled back:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
