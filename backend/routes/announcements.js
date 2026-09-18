const express = require('express');
const pool    = require('../db/pool');
const { authRequired, roleRequired, assertGroup } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { announcementLimiter }        = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

// GET /api/announcements?groupId=
router.get('/', authRequired, async (req, res, next) => {
  try {
    // Non-superadmin is pinned to own group; superadmin may pass any groupId or none.
    const groupId = req.user.role === 'superadmin' ? req.query.groupId : req.user.groupId;
    const params = [];
    let where = '';
    if (groupId) { params.push(groupId); where = 'WHERE group_id=$1'; }
    const { rows } = await pool.query(
      `SELECT * FROM announcements ${where} ORDER BY posted_at DESC LIMIT 100`,
      params
    );
    res.json({ success: true, announcements: rows });
  } catch (err) { next(err); }
});

// POST /api/announcements
router.post('/', authRequired, announcementLimiter, validate(z.object({
  groupId: z.string().min(1),
  type:    z.string().min(1).max(50),
  title:   z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
})), async (req, res, next) => {
  try {
    if (!['collector','admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    if (!assertGroup(req, res, req.body.groupId)) return;
    const id = 'ann_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const { rows: author } = await pool.query('SELECT name FROM users WHERE id=$1', [req.user.sub]);
    await pool.query(
      'INSERT INTO announcements(id,group_id,author_id,author_name,type,title,content) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, req.body.groupId, req.user.sub, author[0]?.name || '', req.body.type, req.body.title, req.body.content]
    );
    const { rows } = await pool.query('SELECT * FROM announcements WHERE id=$1', [id]);
    await audit({ actorId: req.user.sub, action: 'create_announcement', entityType: 'announcement', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, announcement: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/announcements/:id
router.put('/:id', authRequired, validate(z.object({
  title:   z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(2000).optional(),
  type:    z.string().min(1).max(50).optional(),
}).passthrough()), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });

    // Author may edit own; admin may edit within their own group; superadmin anywhere.
    const canEdit = req.user.role === 'superadmin'
      || cur[0].author_id === req.user.sub
      || (req.user.role === 'admin' && cur[0].group_id === req.user.groupId);
    if (!canEdit) return res.status(403).json({ success: false, error: 'forbidden' });

    const sets = []; const params = [];
    for (const col of ['title','content','type']) {
      if (req.body[col] !== undefined) { params.push(req.body[col]); sets.push(`${col}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'nothing to update' });
    params.push(req.params.id);
    await pool.query(`UPDATE announcements SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'update_announcement', entityType: 'announcement', entityId: req.params.id, before: cur[0], after: rows[0], ip: req.ip });
    res.json({ success: true, announcement: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/announcements/:id
router.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM announcements WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'not found' });
    const canDelete = req.user.role === 'superadmin'
      || rows[0].author_id === req.user.sub
      || (req.user.role === 'admin' && rows[0].group_id === req.user.groupId);
    if (!canDelete) return res.status(403).json({ success: false, error: 'forbidden' });
    await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'delete_announcement', entityType: 'announcement', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
