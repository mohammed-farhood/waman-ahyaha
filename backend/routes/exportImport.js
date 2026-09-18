const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { roleRequired }     = require('../middleware/auth');
const { write: audit }     = require('../services/audit');
const { normalize, hmac }  = require('../services/phone');

const router = express.Router();

// GET /api/export  (superadmin, rate-limited in app.js)
router.get('/', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const key = process.env.PG_ENC_KEY;
    const [users, groups, donations, announcements, orphans, campaignReqs, supportMsgs, payReports, auditLogs] =
      await Promise.all([
        pool.query('SELECT id,name,phone,role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id FROM users WHERE deleted_at IS NULL'),
        pool.query('SELECT id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge FROM groups WHERE deleted_at IS NULL'),
        pool.query('SELECT group_id,month_key,user_id,paid,amount,paid_date,collector_id FROM donations'),
        pool.query('SELECT * FROM announcements ORDER BY posted_at'),
        pool.query(`SELECT id,group_id,code,province,type,amount,status,pgp_sym_decrypt(name_enc,$1) AS name,pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,pgp_sym_decrypt(notes_enc,$1) AS notes FROM orphans`, [key]),
        pool.query('SELECT * FROM campaign_requests ORDER BY created_at'),
        pool.query('SELECT * FROM support_messages ORDER BY created_at'),
        pool.query('SELECT * FROM pay_reports ORDER BY created_at'),
        pool.query('SELECT id,actor_id,action,entity_type,entity_id,before,after,ip,ua,created_at FROM audit_logs ORDER BY created_at'),
      ]);

    const payload = {
      exportDate: new Date().toISOString(),
      version: '2.0',
      users:            users.rows,
      groups:           groups.rows,
      donations:        donations.rows,
      announcements:    announcements.rows,
      orphans:          orphans.rows,
      campaignRequests: campaignReqs.rows,
      supportMessages:  supportMsgs.rows,
      payReports:       payReports.rows,
      auditLogs:        auditLogs.rows,
    };

    const jsonStr = JSON.stringify(payload);
    const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
    payload.checksum = checksum;

    const recordCounts = {
      users: users.rows.length, groups: groups.rows.length,
      donations: donations.rows.length, announcements: announcements.rows.length,
      orphans: orphans.rows.length, campaignRequests: campaignReqs.rows.length,
      supportMessages: supportMsgs.rows.length, payReports: payReports.rows.length,
      auditLogs: auditLogs.rows.length,
    };

    const filename = `alayn-backup-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    await pool.query(
      `INSERT INTO backups(type,actor_id,filename,size_bytes,record_counts,checksum) VALUES($1,$2,$3,$4,$5,$6)`,
      ['manual', req.user.sub, filename, Buffer.byteLength(jsonStr), JSON.stringify(recordCounts), checksum]
    );

    await audit({ actorId: req.user.sub, action: 'export_all', entityType: 'system', after: recordCounts, ip: req.ip });

    res.json(payload);
  } catch (err) { next(err); }
});

// GET /api/export/group/:groupId  (superadmin — single campaign export)
router.get('/group/:groupId', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const key = process.env.PG_ENC_KEY;

    const groupRes = await pool.query('SELECT id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge FROM groups WHERE id=$1 AND deleted_at IS NULL', [groupId]);
    if (!groupRes.rows.length) return res.status(404).json({ error: 'group not found' });

    const [users, donations, announcements, orphans, payReports] = await Promise.all([
      pool.query('SELECT id,name,phone,role,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id FROM users WHERE group_id=$1 AND deleted_at IS NULL', [groupId]),
      pool.query('SELECT group_id,month_key,user_id,paid,amount,paid_date,collector_id FROM donations WHERE group_id=$1', [groupId]),
      pool.query('SELECT * FROM announcements WHERE group_id=$1 ORDER BY posted_at', [groupId]),
      pool.query(`SELECT id,group_id,code,province,type,amount,status,pgp_sym_decrypt(name_enc,$1) AS name,pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,pgp_sym_decrypt(notes_enc,$1) AS notes FROM orphans WHERE group_id=$2`, [key, groupId]),
      pool.query('SELECT * FROM pay_reports WHERE group_id=$1 ORDER BY created_at', [groupId]),
    ]);

    await audit({ actorId: req.user.sub, action: 'export_group', entityType: 'group', entityId: groupId, ip: req.ip });

    res.json({
      exportDate: new Date().toISOString(),
      version: '2.0',
      scope: 'group',
      group:          groupRes.rows[0],
      users:          users.rows,
      donations:      donations.rows,
      announcements:  announcements.rows,
      orphans:        orphans.rows,
      payReports:     payReports.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/export/backups  (superadmin — backup history)
router.get('/backups', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, u.name AS actor_name FROM backups b LEFT JOIN users u ON u.id = b.actor_id ORDER BY b.created_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/import  (superadmin — full import in one transaction)
router.post('/', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const data = req.body;
    const key  = process.env.PG_ENC_KEY;
    const client = await pool.connect();
    const stats = { users: 0, groups: 0, donations: 0, announcements: 0, orphans: 0 };

    try {
      await client.query('BEGIN');

      const groupsData = data.groups || (data.group ? [data.group] : {});
      for (const g of Object.values(groupsData)) {
        await client.query(
          `INSERT INTO groups(id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [g.id, g.name, g.university||null, g.icon||null,
           g.orphansSponsored||g.orphans_sponsored||0,
           g.costPerOrphan||g.cost_per_orphan||25000,
           g.monthlyGoal||g.monthly_goal||0,
           g.defaultPledge||g.default_pledge||5000,
           g.createdAt||g.created_at||new Date()]
        );
        stats.groups++;
      }

      for (const u of Object.values(data.users || {})) {
        let phone = u.phone;
        let phoneHash;
        try { phone = normalize(u.phone); phoneHash = hmac(phone, process.env.PHONE_HMAC_KEY); }
        catch { continue; }

        let pinHash = u.pin_hash || null;
        if (!pinHash && u.pin) pinHash = await bcrypt.hash(String(u.pin), 12);

        await client.query(
          `INSERT INTO users(id,name,phone,phone_hash,role,pin_hash,group_id,collector_id,amount,is_anonymous,join_date,stage,availability,telegram_chat_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
          [u.id, u.name, phone, phoneHash, u.role, pinHash,
           u.groupId||u.group_id||null, u.collectorId||u.collector_id||null,
           u.amount||0, !!u.isAnonymous||!!u.is_anonymous,
           u.joinDate||u.join_date||new Date(),
           u.stage||null,
           u.availability ? JSON.stringify(u.availability) : null,
           u.telegramChatId||u.telegram_chat_id||null]
        );
        stats.users++;
      }

      // Flat donations array or nested object format
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

      for (const a of (data.announcements || [])) {
        await client.query(
          `INSERT INTO announcements(id,group_id,author_id,author_name,type,title,content,posted_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [a.id, a.groupId||a.group_id, a.authorId||a.author_id||null, a.authorName||a.author_name||'',
           a.type||'news', a.title, a.content, a.date||a.posted_at||new Date()]
        );
        stats.announcements++;
      }

      for (const o of (data.orphans || [])) {
        await client.query(
          `INSERT INTO orphans(id,group_id,name_enc,code,province,type,amount,birth_date_enc,status,notes_enc)
           VALUES($1,$2,pgp_sym_encrypt($3,$10),$4,$5,$6,$7,pgp_sym_encrypt($8,$10),$9,pgp_sym_encrypt($11,$10))
           ON CONFLICT (id) DO NOTHING`,
          [o.id, o.groupId||o.group_id, o.name||'', o.code||null, o.province||null,
           o.type||null, o.amount||null, o.birthDate||o.birth_date||null, o.status||null, key, o.notes||null]
        );
        stats.orphans++;
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    await audit({ actorId: req.user.sub, action: 'import_all', entityType: 'system', after: stats, ip: req.ip });
    res.json({ success: true, imported: stats });
  } catch (err) { next(err); }
});

module.exports = router;
