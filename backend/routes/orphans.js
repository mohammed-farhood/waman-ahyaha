const express = require('express');
const pool    = require('../db/pool');
const { authRequired, roleRequired, effectiveGroupId, assertGroup } = require('../middleware/auth');
const { write: audit }               = require('../services/audit');
const { body: validate }             = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

function encField(val, key) {
  // Returns SQL expression for encrypting a value
  return val != null ? `pgp_sym_encrypt($VAL, '${key}')` : 'NULL';
}

async function decryptOrphan(row, key) {
  if (!row) return null;
  const { rows } = await pool.query(
    `SELECT
       id, group_id, code, province, type, amount, status,
       pgp_sym_decrypt(name_enc,$1)       AS name,
       pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,
       pgp_sym_decrypt(notes_enc,$1)      AS notes
     FROM orphans WHERE id=$2`,
    [key, row.id]
  );
  return rows[0] || null;
}

// GET /api/orphans?groupId=
router.get('/', authRequired, async (req, res, next) => {
  try {
    const key = process.env.PG_ENC_KEY;
    const gid = effectiveGroupId(req);
    const params = [key];
    let where = '';
    if (gid) { params.push(gid); where = 'AND group_id=$2'; }
    // superadmin without groupId → see all
    const { rows } = await pool.query(
      `SELECT id, group_id, code, province, type, amount, status,
         pgp_sym_decrypt(name_enc,$1)       AS name,
         pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,
         pgp_sym_decrypt(notes_enc,$1)      AS notes
       FROM orphans WHERE true ${where} ORDER BY id`,
      params
    );
    res.json({ success: true, orphans: rows });
  } catch (err) { next(err); }
});

// POST /api/orphans
router.post('/', ...roleRequired('admin', 'superadmin'), validate(z.object({
  groupId:   z.string().min(1),
  name:      z.string().min(2).max(200),
  code:      z.string().optional(),
  province:  z.string().optional(),
  type:      z.string().optional(),
  amount:    z.number().int().min(0).optional(),
  birthDate: z.string().optional(),
  status:    z.string().optional(),
  notes:     z.string().optional(),
})), async (req, res, next) => {
  try {
    const key = process.env.PG_ENC_KEY;
    const b = req.body;
    // Non-superadmin admins can only create orphans in their own group.
    if (!assertGroup(req, res, b.groupId)) return;
    const id = 'orph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO orphans(id,group_id,name_enc,code,province,type,amount,birth_date_enc,status,notes_enc)
       VALUES($1,$2,pgp_sym_encrypt($3,$9),$4,$5,$6,$7,pgp_sym_encrypt($8,$9),$10,pgp_sym_encrypt($11,$9))`,
      [id, b.groupId, b.name, b.code||null, b.province||null, b.type||null,
       b.amount||null, b.birthDate||null, key, b.status||null, b.notes||null]
    );
    const { rows } = await pool.query(
      `SELECT id,group_id,code,province,type,amount,status,
         pgp_sym_decrypt(name_enc,$1) AS name,
         pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,
         pgp_sym_decrypt(notes_enc,$1) AS notes
       FROM orphans WHERE id=$2`, [key, id]
    );
    await audit({ actorId: req.user.sub, action: 'create_orphan', entityType: 'orphan', entityId: id, ip: req.ip });
    res.status(201).json({ success: true, orphan: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/orphans/:id
router.put('/:id', ...roleRequired('admin', 'superadmin'), validate(z.object({
  name:      z.string().min(2).max(200).optional(),
  code:      z.string().optional(),
  province:  z.string().optional(),
  type:      z.string().optional(),
  amount:    z.number().int().min(0).optional(),
  birthDate: z.string().optional(),
  status:    z.string().optional(),
  notes:     z.string().optional(),
}).passthrough()), async (req, res, next) => {
  try {
    const key = process.env.PG_ENC_KEY;
    const b = req.body;
    // Verify orphan exists and belongs to caller's group (or caller is superadmin).
    const { rows: cur } = await pool.query('SELECT group_id FROM orphans WHERE id=$1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });
    if (!assertGroup(req, res, cur[0].group_id)) return;
    const sets = []; const params = [key];

    const plain = { code:'code', province:'province', type:'type', amount:'amount', status:'status' };
    const enc   = { name:'name_enc', birthDate:'birth_date_enc', notes:'notes_enc' };

    for (const [k, col] of Object.entries(plain)) {
      if (b[k] !== undefined) { params.push(b[k]); sets.push(`${col}=$${params.length}`); }
    }
    for (const [k, col] of Object.entries(enc)) {
      if (b[k] !== undefined) { params.push(b[k]); sets.push(`${col}=pgp_sym_encrypt($${params.length},$1)`); }
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'nothing to update' });
    params.push(req.params.id);
    await pool.query(`UPDATE orphans SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    const { rows } = await pool.query(
      `SELECT id,group_id,code,province,type,amount,status,
         pgp_sym_decrypt(name_enc,$1) AS name,
         pgp_sym_decrypt(birth_date_enc,$1) AS birth_date,
         pgp_sym_decrypt(notes_enc,$1) AS notes
       FROM orphans WHERE id=$2`, [key, req.params.id]
    );
    await audit({ actorId: req.user.sub, action: 'update_orphan', entityType: 'orphan', entityId: req.params.id, ip: req.ip });
    res.json({ success: true, orphan: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/orphans/:id
router.delete('/:id', ...roleRequired('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query('SELECT group_id FROM orphans WHERE id=$1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ success: false, error: 'not found' });
    if (!assertGroup(req, res, cur[0].group_id)) return;
    await pool.query('DELETE FROM orphans WHERE id=$1', [req.params.id]);
    await audit({ actorId: req.user.sub, action: 'delete_orphan', entityType: 'orphan', entityId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
