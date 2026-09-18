require('dotenv').config();

const app    = require('./app');
const runner = require('./db/runner');
const tg     = require('./services/telegramBot');

const port = process.env.PORT || 7860;
// Behind nginx set HOST=127.0.0.1 so the API is not reachable directly from outside.
const host = process.env.HOST || '0.0.0.0';

async function main() {
  await runner.up();
  tg.init();
  app.listen(port, host, () => {
    console.log(`[SERVER] Running on http://${host}:${port}`);
    console.log(`[ENV] NODE_ENV=${process.env.NODE_ENV} COOKIE_SECURE=${process.env.COOKIE_SECURE}`);
  });
}

// Log, don't crash: one failed background promise must not take the API down.
process.on('unhandledRejection', (err) => console.error('[UNHANDLED]', err));

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
