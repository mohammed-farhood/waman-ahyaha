-- Migration 0005: columns the frontend already relies on, and integrity fixes.

-- Announcements: the UI lets you pin a post and attach an image; neither was stored.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image     TEXT;   -- data:image/...;base64 URL

-- Support messages: remember who sent them and which campaign they belong to,
-- so senders can see their own messages and admins only see their campaign's.
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS from_user_id TEXT;
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS group_id     TEXT;
CREATE INDEX IF NOT EXISTS idx_support_group ON support_messages(group_id, created_at DESC);

-- A deleted user's phone number must be free to register again. The original
-- UNIQUE(phone_hash) also counted soft-deleted rows.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_hash_active ON users(phone_hash) WHERE deleted_at IS NULL;
