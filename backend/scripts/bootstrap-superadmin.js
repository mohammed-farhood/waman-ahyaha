#!/usr/bin/env node
/**
 * Bootstrap superadmin accounts on a fresh database.
 * Run once: node scripts/bootstrap-superadmin.js
 *
 * Supports up to 2 superadmin accounts.
 *
 * Required in .env:
 *   SUPERADMIN_PHONE_1=+9647XXXXXXXXX   (first superadmin)
 *   SUPERADMIN_PIN_1=your_pin
 *   SUPERADMIN_NAME_1=مدير التطبيق       (optional)
 *
 *   SUPERADMIN_PHONE_2=+9647XXXXXXXXX   (optional second superadmin)
 *   SUPERADMIN_PIN_2=your_pin
 *   SUPERADMIN_NAME_2=مدير التطبيق 2    (optional)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const pool   = require('../db/pool');
const { normalize, hmac } = require('../services/phone');

const accounts = [
  {
    phone: process.env.SUPERADMIN_PHONE_1,
    pin:   process.env.SUPERADMIN_PIN_1,
    name:  process.env.SUPERADMIN_NAME_1 || 'مدير التطبيق',
  },
  {
    phone: process.env.SUPERADMIN_PHONE_2,
    pin:   process.env.SUPERADMIN_PIN_2,
    name:  process.env.SUPERADMIN_NAME_2 || 'مدير التطبيق 2',
  },
].filter(a => a.phone && a.pin); // skip if not configured

async function main() {
  if (accounts.length === 0) {
    console.error('[bootstrap] Set at least SUPERADMIN_PHONE_1 and SUPERADMIN_PIN_1 in .env');
    process.exit(1);
  }

  for (const account of accounts) {
    if (String(account.pin).length < 4) {
      console.error(`[bootstrap] PIN for ${account.phone} must be at least 4 digits`);
      process.exit(1);
    }

    let phone, phoneHash;
    try {
      phone     = normalize(account.phone);
      phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY);
    } catch (e) {
      console.error(`[bootstrap] Invalid phone number "${account.phone}":`, e.message);
      process.exit(1);
    }

    const pinHash = await bcrypt.hash(String(account.pin), 12);

    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE phone_hash=$1 AND deleted_at IS NULL',
      [phoneHash]
    );

    if (existing.length > 0) {
      // Update PIN + name + ensure role; clear lockout. Idempotent.
      await pool.query(
        `UPDATE users
           SET pin_hash=$1, name=$2, role='superadmin',
               failed_attempts=0, locked_until=NULL, updated_at=now()
         WHERE id=$3`,
        [pinHash, account.name, existing[0].id]
      );
      console.log(`[bootstrap] ↻ Superadmin updated: ${existing[0].id}`);
      console.log(`            Phone: ${phone}`);
      console.log(`            Name:  ${account.name}`);
      continue;
    }

    const id = 'usr_superadmin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await pool.query(
      `INSERT INTO users(id, name, phone, phone_hash, role, pin_hash)
       VALUES($1, $2, $3, $4, 'superadmin', $5)`,
      [id, account.name, phone, phoneHash, pinHash]
    );
    console.log(`[bootstrap] ✓ Superadmin created: ${id}`);
    console.log(`            Phone: ${phone}`);
    console.log(`            Name:  ${account.name}`);
  }

  console.log('\n[bootstrap] Done. You can now log in with the phone numbers and PINs you set.');
  await pool.end();
}

main().catch(err => {
  console.error('[bootstrap] Fatal:', err.message);
  process.exit(1);
});
