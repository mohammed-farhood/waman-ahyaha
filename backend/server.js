require('dotenv').config();

const app    = require('./app');
const runner = require('./db/runner');
const tg     = require('./services/telegramBot');

const port = process.env.PORT || 7860;

async function main() {
  await runner.up();
  tg.init();
  app.listen(port, () => {
    console.log(`[SERVER] Running on http://localhost:${port}`);
    console.log(`[ENV] NODE_ENV=${process.env.NODE_ENV} COOKIE_SECURE=${process.env.COOKIE_SECURE}`);
  });
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
