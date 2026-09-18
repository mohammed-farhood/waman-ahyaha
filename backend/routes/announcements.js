const express = require('express');
const pool    = require('../db/pool');
const { authRequired, assertGroup } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { announcementLimiter }        = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

// Images are stored as data URLs but never inlined in list responses (100 posts
// with photos would be tens of MB); the list carries a URL to the image route.
const COLS = `id, group_id, author_id, author_name, type, title, content, posted_at, is_pinned,
  CASE WHEN image IS NOT NULL THEN '/api/announcements/' || id || '/image' END AS image`;

const imageField = z.string().max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'image must be a base64 data URL')
  .nullable().optional();

// GET /api/announcements?groupId=
router.get('/', authRequired, async (req, res, next) => {
  try {
    // Non-superadmin is pinned to own group; superadmin may pass any groupId or none.
    const groupId = req.user.role === 'superadmin' ? req.query.groupId : req.user.groupId;
    const params = [];
    let where = '';
    if (groupId) { params.push(groupId); where = 'WHERE group_id=$1'; }
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM announcements ${where} ORDER BY posted_at DESC LIMIT 100`,
      params
    );
    res.json({ success: true, announcements: rows });
  } catch (err) { next(err); }
});

// GET /api/announcements/:id/image
router.get('/:id/image', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT group_id, image FROM announcements WHERE id=$1', [req.params.id]);
    if (!rows[0] || !rows[0].image) return res.status(404).json({ success: false, error: 'not found' });
    if (!assertGroup(req, res, rows[0].group_id)) return;
    const m = rows[0].image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m) return res.status(404).json({ success: false, error: 'not found' });
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(m[2], 'base64'));
  } catch (err) { next(err); }
});

// POST /api/announcements
router.post('/', authRequired, announcementLimiter, validate(z.object({
  groupId:  z.string().min(1),
  type:     z.string().min(1).max(50).default('general'),
  title:    z.string().max(120).default(''),
  content:  z.string().max(2000).default(''),
  isPinned: z.boolean().optional(),
  image:    imageField,
}).refine(b => b.content.trim() || b.image, { message: 'content or image required', path: ['content'] })),
async (req, res, next) => {
  try {
    if (!['collector','admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    if (!assertGroup(req, res, req.body.groupId)) return;
    const id = 'ann_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const { rows: author } = await pool.query('SELECT name FROM users WHERE id=$1', [req.user.sub]);
    await pool.query(
      `INSERT INTO announcements(id,group_id,author_id,author_name,type,title,content,is_pinned,image)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.body.groupId, req.user.sub, author[0]?.name || '', req.body.type, req.body.title,
       req.body.content, !!req.body.isPinned, req.body.image || null]
    );
    const { rows } = await pool.query(`SELECT ${COLS} FROM announcements WHERE id=$1`, [id]);
    await audit({ actorId: req.user.sub, action: 'create_announcement', entityType: 'announcement', entityId: id, after: rows[0], ip: req.ip });
    res.status(201).json({ success: true, announcement: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/announcements/:id
router.put('/:id', authRequired, validate(z.object({
  title:    z.string().max(120).optional(),
  content:  z.string().max(2000).optional(),
  type:     z.string().min(1).max(50).optional(),
  isPinned: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query(`SELECT ${COLS} FROM announcements WHERE id=$1`, [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });

    // Author may edit own; admin may edit within their own group; superadmin anywhere.
    const canEdit = req.user.role === 'superadmin'
      || cur[0].author_id === req.user.sub
      || (req.user.role === 'admin' && cur[0].group_id === req.user.groupId);
    if (!canEdit) return res.status(403).json({ success: false, error: 'forbidden' });

    const sets = []; const params = [];
    for (const [key, col] of [['title','title'],['content','content'],['type','type'],['isPinned','is_pinned']]) {
      if (req.body[key] !== undefined) { params.push(req.body[key]); sets.push(`${col}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'nothing to update' });
    params.push(req.params.id);
    await pool.query(`UPDATE announcements SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    const { rows } = await pool.query(`SELECT ${COLS} FROM announcements WHERE id=$1`, [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'update_announcement', entityType: 'announcement', entityId: req.params.id, before: cur[0], after: rows[0], ip: req.ip });
    res.json({ success: true, announcement: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/announcements/:id
router.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, group_id, author_id FROM announcements WHERE id=$1', [req.params.id]);
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
