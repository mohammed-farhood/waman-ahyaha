const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { authRequired } = require('../middleware/auth');
const { reminderQueue, getDefaultUsername } = require('../services/telegramBot');
const { body: validate } = require('../middleware/validate');
const { telegramLimiter } = require('../middleware/rateLimit');
const { z } = require('zod');

const router = express.Router();

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
router.post('/auth-code', async (req, res, next) => {
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

    // Resolve the bot username to use
    let botUsername = getDefaultUsername();
    if (groupId) {
      const { rows } = await pool.query(
        'SELECT telegram_bot_token_enc IS NOT NULL AS has_custom FROM groups WHERE id=$1', [groupId]
      );
      if (rows[0]?.has_custom) {
        try {
          const { getOrCreateCampaignBot } = require('../services/telegramBot');
          const entry = await getOrCreateCampaignBot(groupId);
          botUsername = entry.username;
        } catch {}
      }
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
router.post('/send-reminders', authRequired, telegramLimiter, validate(z.object({
  messages: z.array(z.object({
    chatId: z.union([z.string(), z.number()]),
    text:   z.string().min(1).max(4000),
  })).min(1).max(50),
})), async (req, res, next) => {
  try {
    const groupId = req.user.groupId || null;
    const batch = req.body.messages.map(m => ({
      chatId: m.chatId,
      text: sanitizeHtml(m.text),
      groupId,
    }));
    reminderQueue.add(batch);
    res.json({ success: true, status: 'queued', count: batch.length });
  } catch (err) { next(err); }
});

// POST /api/send-receipt
router.post('/send-receipt', authRequired, validate(z.object({
  chatId:        z.union([z.string(), z.number()]),
  donorName:     z.string().optional(),
  amount:        z.number(),
  month:         z.string(),
  collectorName: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { chatId, donorName, amount, month, collectorName } = req.body;
    const name      = sanitizeHtml(donorName || '');
    const collector = sanitizeHtml(collectorName || 'غير محدد');
    const text = `🧾 <b>وصل استلام تبرع كفالة أيتام</b> 🧾\n\n` +
                 `مرحباً ${name}،\n` +
                 `تم استلام تبرعك لشهر <b>${month}</b> بنجاح.\n\n` +
                 `💰 <b>المبلغ</b>: ${amount} دينار عراقي\n` +
                 `👤 <b>الجامع</b>: ${collector}\n` +
                 `📅 <b>التاريخ</b>: ${new Date().toLocaleDateString('ar-EG-u-nu-latn')}\n\n` +
                 `اليتيم المليء بالشكر يدعو لك! شكراً لعطائك. 🌸`;
    reminderQueue.add([{ chatId, text, groupId: req.user.groupId || null }]);
    res.json({ success: true, status: 'receipt_queued' });
  } catch (err) { next(err); }
});

// POST /api/notify-location
router.post('/notify-location', authRequired, validate(z.object({
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
    const messages = chatIds.map(chatId => ({ chatId, text, groupId: req.user.groupId || null }));
    reminderQueue.add(messages);
    res.json({ success: true, status: 'location_queued', count: messages.length });
  } catch (err) { next(err); }
});

module.exports = router;
