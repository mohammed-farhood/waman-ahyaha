-- Migration 0006: remember each campaign bot's @username (public, shown in the app)
-- so the UI can say which bot is connected without decrypting the token.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS telegram_bot_username TEXT;
