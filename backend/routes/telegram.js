const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { roleRequired } = require('../middleware/auth');
const tg = require('../services/telegramBot');
const { reminderQueue } = tg;
const { body: validate } = require('../middleware/validate');
const { write: audit } = require('../services/audit');
const { telegramLimiter } = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();
const STAFF = ['collector', 'admin', 'superadmin'];

// Only chats that belong to members of the caller's own campaign can be messaged
// (superadmin: any registered member). Stops the bot being used to spam strangers.
async function allowedChats(req, chatIds) {
  const ids = [...new Set(chatIds.map(String))].filter(c => /^-?\d{1,20}$/.test(c));
  if (!ids.length) return new Set();
  const params = [ids];
  let where = 'telegram_chat_id = ANY($1::bigint[]) AND deleted_at IS NULL';
  if (req.user.role !== 'superadmin') { params.push(req.user.groupId); where += ' AND group_id = $2'; }
  const { rows } = await pool.query(`SELECT telegram_chat_id::text AS c FROM users WHERE ${where}`, params);
  return new Set(rows.map(r => r.c));
}

function sanitizeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(m =>
    m && (typeof m.chatId === 'number' || typeof m.chatId === 'string') &&
    typeof m.text === 'string' && m.text.trim().length > 0
  );
}

// POST /api/auth-code  — generate linking code (auth not required, but session-aware)
router.post('/auth-code', telegramLimiter, async (req, res, next) => {
  try {
    // groupId from authenticated session if available; anonymous allowed for initial link
    let groupId = null;
    try {
      const jwt = require('jsonwebtoken');
      const t = req.cookies?.alayn_at || (req.headers.authorization||'').replace('Bearer ','');
      if (t) { const u = jwt.verify(t, process.env.JWT_SECRET); groupId = u.groupId || null; }
    } catch {}

    // Crockford-style base32 (no I/L/O/U) over 10 chars from 8 random bytes ≈ 50 bits of entropy.
    const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    const bytes = crypto.randomBytes(10);
    let suffix = '';
    for (let i = 0; i < 10; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
    const code = 'AUTH-' + suffix;
    await pool.query(
      'INSERT INTO auth_codes(code, status, group_id) VALUES($1,$2,$3)',
      [code, 'pending', groupId]
    );

    // The campaign's own bot if it has one, otherwise the platform default.
    let botUsername = '';
    try { botUsername = (await tg.getOrCreateCampaignBot(groupId)).username; }
    catch (e) { console.error('[BOT] auth-code bot start failed:', e.message); }

    if (!botUsername) {
      return res.status(503).json({ success: false, error: 'telegram bot not configured' });
    }
    res.json({ success: true, code, botUsername });
  } catch (err) { next(err); }
});

// GET /api/check-auth/:code
router.get('/check-auth/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT status, chat_id FROM auth_codes WHERE code=$1', [req.params.code]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'code not found' });
    res.json({ success: true, status: rows[0].status, chatId: rows[0].chat_id });
  } catch (err) { next(err); }
});

// POST /api/send-reminders
router.post('/send-reminders', ...roleRequired(...STAFF), telegramLimiter, validate(z.object({
  messages: z.array(z.object({
    chatId: z.union([z.string(), z.number()]),
    text:   z.string().min(1).max(4000),
  })).min(1).max(50),
})), async (req, res, next) => {
  try {
    const groupId = req.user.groupId || null;
    const ok = await allowedChats(req, req.body.messages.map(m => m.chatId));
    const batch = req.body.messages.filter(m => ok.has(String(m.chatId))).map(m => ({
      chatId: m.chatId,
      text: sanitizeHtml(m.text),
      groupId,
    }));
    if (batch.length) reminderQueue.add(batch);
    res.json({ success: true, status: 'queued', count: batch.length });
  } catch (err) { next(err); }
});

// POST /api/send-receipt
router.post('/send-receipt', ...roleRequired(...STAFF), telegramLimiter, validate(z.object({
  chatId:        z.union([z.string(), z.number()]),
  donorName:     z.string().optional(),
  amount:        z.number(),
  month:         z.string(),
  collectorName: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { chatId, donorName, amount, month, collectorName } = req.body;
    if (!(await allowedChats(req, [chatId])).has(String(chatId))) {
      return res.status(403).json({ success: false, error: 'forbidden: chat not in this campaign' });
    }
    const name      = sanitizeHtml(donorName || '');
    const collector = sanitizeHtml(collectorName || 'غير محدد');
    const text = `🧾 <b>وصل استلام تبرع كفالة أيتام</b> 🧾\n\n` +
                 `مرحباً ${name}،\n` +
                 `تم استلام تبرعك لشهر <b>${sanitizeHtml(month)}</b> بنجاح.\n\n` +
                 `💰 <b>المبلغ</b>: ${amount} دينار عراقي\n` +
                 `👤 <b>الجامع</b>: ${collector}\n` +
                 `📅 <b>التاريخ</b>: ${new Date().toLocaleDateString('ar-EG-u-nu-latn')}\n\n` +
                 `اليتيم المليء بالشكر يدعو لك! شكراً لعطائك. 🌸`;
    reminderQueue.add([{ chatId, text, groupId: req.user.groupId || null }]);
    res.json({ success: true, status: 'receipt_queued' });
  } catch (err) { next(err); }
});

// POST /api/notify-location
router.post('/notify-location', ...roleRequired(...STAFF), telegramLimiter, validate(z.object({
  chatIds:       z.array(z.union([z.string(), z.number()])).min(1).max(100),
  collectorName: z.string().optional(),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
})), async (req, res, next) => {
  try {
    const { chatIds, collectorName, lat, lng } = req.body;
    const name = sanitizeHtml(collectorName || '');
    const mapLink = `https://maps.google.com/?q=${lat},${lng}`;
    const text = `📍 <b>متواجد الآن لاستلام التبرعات</b> 📍\n\n` +
                 `جامع التبرعات (${name}) متواجد حالياً ويستقبل التبرعات.\n\n` +
                 `اضغط على الرابط أدناه للوصول إلى موقعه على الخريطة:\n${mapLink}\n\n` +
                 `إدارة تطبيق ومن أحياها`;
    const ok = await allowedChats(req, chatIds);
    const messages = chatIds.filter(c => ok.has(String(c)))
      .map(chatId => ({ chatId, text, groupId: req.user.groupId || null }));
    if (messages.length) reminderQueue.add(messages);
    res.json({ success: true, status: 'location_queued', count: messages.length });
  } catch (err) { next(err); }
});

// ── Platform default bot (superadmin, from the app's settings) ──
router.get('/telegram/default-bot', ...roleRequired('superadmin'), (req, res) => {
  const d = tg.defaultInfo();
  res.json({ success: true, connected: d.connected, username: d.username, source: d.source });
});

router.post('/telegram/default-bot', ...roleRequired('superadmin'), validate(z.object({
  botToken: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, 'invalid bot token'),
})), async (req, res, next) => {
  try {
    const username = await tg.setDefaultBot(req.body.botToken);   // 400 'invalid bot token'
    await audit({ actorId: req.user.sub, action: 'set_default_bot', entityType: 'system', after: { username }, ip: req.ip });
    res.json({ success: true, username });
  } catch (err) { next(err); }
});

router.delete('/telegram/default-bot', ...roleRequired('superadmin'), async (req, res, next) => {
  try {
    await tg.setDefaultBot(null);
    await audit({ actorId: req.user.sub, action: 'remove_default_bot', entityType: 'system', ip: req.ip });
    res.json({ success: true, ...tg.defaultInfo() });
  } catch (err) { next(err); }
});

module.exports = router;
