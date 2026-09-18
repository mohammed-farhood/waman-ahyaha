const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db/pool');

const token = process.env.TELEGRAM_BOT_TOKEN;
let bot;
let defaultBotUsername = '';

// Bounded map: max one bot per group, capped at 50 to prevent memory leak.
// In practice the number of groups is small, so this is a safety net only.
const MAX_CAMPAIGN_BOTS = 50;
const campaignBots = new Map(); // botToken -> { bot, username }

function init() {
  if (!token) { console.error('[BOT] TELEGRAM_BOT_TOKEN missing'); return; }
  bot = new TelegramBot(token, { polling: true });

  bot.getMe().then(me => {
    defaultBotUsername = me.username;
    console.log(`[BOT] Default: @${defaultBotUsername}`);
  }).catch(() => {});

  bot.on('message', (msg) => {
    console.log(`[BOT] msg from ${msg.chat.id}: "${msg.text}"`);
  });

  // The library ignores the handler's promise: catch here or a Telegram/DB error
  // becomes an unhandled rejection.
  bot.onText(/\/start (.+)/, (msg, match) =>
    handleStart(msg, match, bot).catch(e => console.error('[BOT] /start failed:', e.message)));
  bot.on('polling_error', (err) => console.error('[BOT POLL]', err.message));

  // Cleanup stale auth codes every 10 minutes
  setInterval(async () => {
    try {
      await pool.query("DELETE FROM auth_codes WHERE created_at < now() - interval '10 minutes'");
    } catch (e) { console.error('[BOT] cleanup error', e.message); }
  }, 10 * 60 * 1000);
}

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

async function getOrCreateCampaignBot(groupId) {
  if (!groupId) return { bot, username: defaultBotUsername };

  const { rows } = await pool.query(
    'SELECT pgp_sym_decrypt(telegram_bot_token_enc,$1) AS tok FROM groups WHERE id=$2 AND telegram_bot_token_enc IS NOT NULL',
    [process.env.PG_ENC_KEY, groupId]
  );
  const tok = rows[0]?.tok;
  if (!tok || tok === token) return { bot, username: defaultBotUsername };

  if (campaignBots.has(tok)) return campaignBots.get(tok);

  // Safety cap: evict and stop the oldest entry if at limit
  if (campaignBots.size >= MAX_CAMPAIGN_BOTS) {
    const [oldestTok, oldest] = campaignBots.entries().next().value;
    try { await oldest.bot.stopPolling(); } catch {}
    campaignBots.delete(oldestTok);
    console.warn(`[BOT] Evicted oldest campaign bot (cap ${MAX_CAMPAIGN_BOTS} reached)`);
  }

  // Check the token BEFORE polling: a revoked token would otherwise leave a
  // failing poller running for every request that touches this group.
  const newBot = new TelegramBot(tok, { polling: false });
  const me = await newBot.getMe();
  newBot.startPolling();
  newBot.onText(/\/start (.+)/, (msg, match) =>
    handleStart(msg, match, newBot).catch(e => console.error('[BOT] /start failed:', e.message)));
  newBot.on('polling_error', err => console.error(`[CAMPAIGN BOT @${me.username}]`, err.message));
  const entry = { bot: newBot, username: me.username };
  campaignBots.set(tok, entry);
  console.log(`[BOT] Campaign bot: @${me.username} (total: ${campaignBots.size})`);
  return entry;
}

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

function getDefaultUsername() { return defaultBotUsername; }

module.exports = { init, reminderQueue, getOrCreateCampaignBot, getDefaultUsername };
