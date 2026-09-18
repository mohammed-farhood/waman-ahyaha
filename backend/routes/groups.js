const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authRequired, roleRequired } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

// GET /api/groups  — public: donor registration picker needs this before login.
// Returns only campaign-discovery fields; nothing sensitive.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge,created_at FROM groups WHERE deleted_at IS NULL ORDER BY created_at'
    );
    res.json({ success: true, groups: rows });
  } catch (err) { next(err); }
});

// GET /api/groups/:id
router.get('/:id', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge,created_at FROM groups WHERE id=$1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, group: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/groups/:id/stats?month=YYYY-MM
router.get('/:id/stats', authRequired, async (req, res, next) => {
  try {
    const { getMonthlyStats } = require('../services/donations');
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const stats = await getMonthlyStats(req.params.id, month);
    res.json({ success: true, stats });
  } catch (err) { next(err); }
});

// POST /api/groups (superadmin)
router.post('/', ...roleRequired('superadmin'), validate(z.object({
  name:             z.string().min(2).max(200),
  university:       z.string().optional(),
  icon:             z.string().optional(),
  orphansSponsored: z.number().int().min(0).optional(),
  costPerOrphan:    z.number().int().min(0).optional(),
  defaultPledge:    z.number().int().min(0).optional(),
})), async (req, res, next) => {
  try {
    const { name, university, icon, orphansSponsored = 0, costPerOrphan = 25000, defaultPledge = 5000 } = req.body;
    const monthlyGoal = orphansSponsored * costPerOrphan;
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO groups(id,name,university,icon,orphans_sponsored,cost_per_orphan,monthly_goal,default_pledge)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name, university || null, icon || null, orphansSponsored, costPerOrphan, monthlyGoal, defaultPledge]
    );
    const { rows } = await pool.query('SELECT * FROM groups WHERE id=$1', [id]);
    await audit({ actorId: req.user.sub, action: 'create_group', entityType: 'group', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, group: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/groups/:id (superadmin)
router.put('/:id', ...roleRequired('superadmin'), validate(z.object({
  name:             z.string().min(2).max(200).optional(),
  university:       z.string().optional(),
  icon:             z.string().optional(),
  orphansSponsored: z.number().int().min(0).optional(),
  costPerOrphan:    z.number().int().min(0).optional(),
  defaultPledge:    z.number().int().min(0).optional(),
}).passthrough()), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM groups WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });

    const map = { name:'name', university:'university', icon:'icon',
      orphansSponsored:'orphans_sponsored', costPerOrphan:'cost_per_orphan', defaultPledge:'default_pledge' };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${col}=$${params.length}`); }
    }
    // Recompute monthly_goal if relevant fields changed
    const sponsored = req.body.orphansSponsored ?? cur[0].orphans_sponsored;
    const cost      = req.body.costPerOrphan    ?? cur[0].cost_per_orphan;
    params.push(sponsored * cost);
    sets.push(`monthly_goal=$${params.length}`);
    if (!sets.length) return res.status(400).json({ success: false, error: 'nothing to update' });

    params.push(req.params.id);
    await pool.query(`UPDATE groups SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'update_group', entityType: 'group', entityId: req.params.id, before: cur[0], after: rows[0], ip: req.ip });
    res.json({ success: true, group: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id (superadmin, soft delete)
router.delete('/:id', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE groups SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    await audit({ actorId: req.user.sub, action: 'delete_group', entityType: 'group', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/full-delete  (superadmin only, requires PIN re-auth)
// HARD-deletes the campaign and every related row: donations, orphans, users
// scoped to this group, announcements, pay_reports. Audit log keeps a snapshot
// for forensic purposes (audit_logs.actor_id is a free TEXT field, no FK).
router.post('/:id/full-delete', ...roleRequired('superadmin'), validate(z.object({
  pin: z.string().min(4).max(20),
})), async (req, res, next) => {
  const client = await pool.connect();
  try {
    // 1) Re-auth: confirm the caller's PIN before doing anything destructive.
    const { rows: actor } = await client.query('SELECT pin_hash FROM users WHERE id=$1', [req.user.sub]);
    if (!actor[0]) return res.status(404).json({ success: false, error: 'user not found' });
    const ok = await bcrypt.compare(String(req.body.pin), actor[0].pin_hash || '');
    if (!ok) return res.status(401).json({ success: false, error: 'current PIN incorrect' });

    // 2) Group must exist.
    const { rows: g } = await client.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!g[0]) return res.status(404).json({ success: false, error: 'not found' });

    // 3) Snapshot counts (for audit + response). Done outside the txn — read-only.
    const counts = {};
    for (const [t, col] of [['donations','group_id'],['orphans','group_id'],
                            ['announcements','group_id'],['pay_reports','group_id'],
                            ['users','group_id']]) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${col}=$1`, [req.params.id]);
      counts[t] = rows[0].n;
    }

    // 4) Cascading delete in a transaction.
    //    donations & orphans use ON DELETE RESTRICT on group_id → must clear them first.
    //    users use ON DELETE SET NULL → also explicit so the group's admins/collectors/donors go.
    //    announcements + pay_reports cascade automatically when the group row dies.
    await client.query('BEGIN');
    await client.query('DELETE FROM donations WHERE group_id=$1', [req.params.id]);
    await client.query('DELETE FROM orphans   WHERE group_id=$1', [req.params.id]);
    await client.query('DELETE FROM users     WHERE group_id=$1', [req.params.id]);
    await client.query('DELETE FROM groups    WHERE id=$1',       [req.params.id]);
    await client.query('COMMIT');

    await audit({
      actorId:    req.user.sub,
      action:     'delete_group_full',
      entityType: 'group',
      entityId:   req.params.id,
      before:     { group: g[0], counts },
      ip:         req.ip,
      ua:         req.headers['user-agent'],
    });

    res.json({ success: true, deleted: counts });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/groups/:id/bot-token  (admin/superadmin — store bot token encrypted)
router.post('/:id/bot-token', ...roleRequired('admin', 'superadmin'), validate(z.object({
  botToken: z.string().regex(/^\d{8,10}:[A-Za-z0-9_-]{35}$/, 'invalid bot token format'),
})), async (req, res, next) => {
  try {
    const key = process.env.PG_ENC_KEY;
    if (!key) return res.status(500).json({ success: false, error: 'encryption key not configured' });
    await pool.query(
      'UPDATE groups SET telegram_bot_token_enc=pgp_sym_encrypt($1,$2) WHERE id=$3',
      [req.body.botToken, key, req.params.id]
    );
    await audit({ actorId: req.user.sub, action: 'set_bot_token', entityType: 'group', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
