const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db/pool');

// Bots are configured from the app, not the server:
//   • each campaign can have its own bot (groups.telegram_bot_token_enc)
//   • the superadmin can set a platform default (settings 'telegram_default_bot'),
//     used by campaigns without their own; TELEGRAM_BOT_TOKEN in the env file is
//     only a fallback for that default.
// Bots start lazily on first use and can be swapped or removed at runtime.

const SETTINGS_KEY = 'telegram_default_bot';
// Test hook: point the bots at a fake Telegram API (unset in production).
const API_OPTS = process.env.TELEGRAM_API_URL ? { baseApiUrl: process.env.TELEGRAM_API_URL } : {};
const MAX_RUNNING_BOTS = 50;          // safety net; in practice one per campaign

const running  = new Map();           // token -> { bot, username }
const starting = new Map();           // token -> Promise (avoid double polling)
let defaultToken  = null;
let defaultSource = null;             // 'app' | 'env' | null

// ── helpers ───────────────────────────────────────────────
async function handleStart(msg, match, responseBot) {
  const chatId = msg.chat.id;
  const code = match[1].trim();
  const { rows } = await pool.query('SELECT * FROM auth_codes WHERE code=$1', [code]);
  if (!rows[0]) {
    await responseBot.sendMessage(chatId, 'عذراً، الرابط غير صحيح أو منتهي الصلاحية.');
    return;
  }
  if (rows[0].status === 'pending') {
    await pool.query('UPDATE auth_codes SET status=$1, chat_id=$2 WHERE code=$3', ['linked', chatId, code]);
    await responseBot.sendMessage(chatId, '✅ تم ربط حسابك في تطبيق ومن أحياها بنجاح!');
  } else {
    await responseBot.sendMessage(chatId, 'هذا الرابط تم استخدامه مسبقاً.');
  }
}

// Ask Telegram who this token belongs to. Throws (status 400) if it's not a valid bot token.
async function verifyToken(token) {
  try {
    const me = await new TelegramBot(token, { polling: false, ...API_OPTS }).getMe();
    return me.username;
  } catch (e) {
    const err = new Error('invalid bot token');
    err.status = 400;
    throw err;
  }
}

async function startBot(token) {
  const b = new TelegramBot(token, { polling: false, ...API_OPTS });
  const me = await b.getMe();                       // bad token → throws, nothing left polling
  // The library ignores the handler's promise: catch here or a Telegram/DB error
  // becomes an unhandled rejection.
  b.onText(/\/start (.+)/, (msg, match) =>
    handleStart(msg, match, b).catch(e => console.error('[BOT] /start failed:', e.message)));
  b.on('polling_error', err => console.error(`[BOT @${me.username}]`, err.message));
  b.startPolling();
  console.log(`[BOT] Started @${me.username} (running: ${running.size + 1})`);
  return { bot: b, username: me.username };
}

async function getBot(token) {
  if (running.has(token)) return running.get(token);
  if (starting.has(token)) return starting.get(token);
  const p = (async () => {
    if (running.size >= MAX_RUNNING_BOTS) {
      const [oldTok] = [...running.keys()].filter(t => t !== defaultToken);
      if (oldTok) await stopBot(oldTok);
    }
    const entry = await startBot(token);
    running.set(token, entry);
    return entry;
  })().finally(() => starting.delete(token));
  starting.set(token, p);
  return p;
}

async function stopBot(token) {
  if (!token || token === defaultToken) return;
  const entry = running.get(token);
  running.delete(token);
  if (entry) { try { await entry.bot.stopPolling(); } catch {} console.log(`[BOT] Stopped @${entry.username}`); }
}

// ── default (platform) bot ────────────────────────────────
async function readDefaultFromDb() {
  const { rows } = await pool.query(
    "SELECT pgp_sym_decrypt(decode(value->>'token_enc','base64'), $1) AS tok FROM settings WHERE key=$2",
    [process.env.PG_ENC_KEY, SETTINGS_KEY]
  );
  return rows[0]?.tok || null;
}

async function applyDefault(token, source) {
  const old = defaultToken;
  defaultToken = null;                               // so stopBot() may stop the old one
  if (old && old !== token) await stopBot(old);
  defaultToken = token || null;
  defaultSource = token ? source : null;
  if (token) {
    try { await getBot(token); }
    catch (e) { console.error('[BOT] default bot failed to start:', e.message); }
  }
}

async function init() {
  let tok = null, source = null;
  try { tok = await readDefaultFromDb(); if (tok) source = 'app'; }
  catch (e) { console.error('[BOT] reading default bot setting failed:', e.message); }
  if (!tok && process.env.TELEGRAM_BOT_TOKEN) { tok = process.env.TELEGRAM_BOT_TOKEN; source = 'env'; }
  if (tok) await applyDefault(tok, source);
  else console.log('[BOT] No default bot (campaigns can add their own in the app)');

  // Cleanup stale auth codes every 10 minutes
  setInterval(async () => {
    try {
      await pool.query("DELETE FROM auth_codes WHERE created_at < now() - interval '10 minutes'");
    } catch (e) { console.error('[BOT] cleanup error', e.message); }
  }, 10 * 60 * 1000);
}

// Superadmin sets/clears the platform default from the app.
async function setDefaultBot(token) {
  if (token) {
    const username = await verifyToken(token);
    await pool.query(
      `INSERT INTO settings(key, value)
       VALUES ($1, jsonb_build_object('token_enc', encode(pgp_sym_encrypt($2, $3), 'base64'), 'username', $4::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SETTINGS_KEY, token, process.env.PG_ENC_KEY, username]
    );
    await applyDefault(token, 'app');
    return username;
  }
  await pool.query('DELETE FROM settings WHERE key=$1', [SETTINGS_KEY]);
  await applyDefault(process.env.TELEGRAM_BOT_TOKEN || null, 'env');
  return null;
}

function defaultInfo() {
  const entry = defaultToken && running.get(defaultToken);
  return { connected: !!entry, username: entry?.username || '', source: defaultSource };
}

function getDefaultUsername() { return defaultInfo().username; }

// ── per-campaign bots ─────────────────────────────────────
async function campaignToken(groupId) {
  const { rows } = await pool.query(
    'SELECT pgp_sym_decrypt(telegram_bot_token_enc,$1) AS tok FROM groups WHERE id=$2 AND telegram_bot_token_enc IS NOT NULL',
    [process.env.PG_ENC_KEY, groupId]
  );
  return rows[0]?.tok || null;
}

// The bot that serves a campaign: its own if set, otherwise the platform default.
// Returns { bot: null, username: '' } when neither exists.
async function getOrCreateCampaignBot(groupId) {
  const tok = groupId ? await campaignToken(groupId) : null;
  if (tok) return getBot(tok);
  if (defaultToken) return getBot(defaultToken);
  return { bot: null, username: '' };
}

// Called after a campaign's token changes: stop the old bot, start the new one.
async function replaceCampaignBot(oldToken, newToken) {
  if (oldToken && oldToken !== newToken) await stopBot(oldToken);
  if (newToken) await getBot(newToken);
}

// ── outgoing message queue ────────────────────────────────
class ReminderQueue {
  constructor() { this.queue = []; this.isProcessing = false; }

  add(messages) {
    this.queue.push(...messages);
    if (!this.isProcessing) this.process();
  }

  async process() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const { chatId, text, groupId } = this.queue.shift();
      try {
        const { bot: targetBot } = await getOrCreateCampaignBot(groupId || null);
        if (!targetBot) throw new Error('telegram bot not configured');
        await targetBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        console.log(`[QUEUE] Sent to ${chatId}`);
      } catch (err) {
        console.error(`[QUEUE ERROR] ${chatId}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    this.isProcessing = false;
  }
}

const reminderQueue = new ReminderQueue();

module.exports = {
  init, reminderQueue, getOrCreateCampaignBot, getDefaultUsername,
  verifyToken, campaignToken, replaceCampaignBot, setDefaultBot, defaultInfo,
};
