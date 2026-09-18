-- Migration 0004: Backup metadata table
CREATE TABLE IF NOT EXISTS backups (
  id            SERIAL PRIMARY KEY,
  type          VARCHAR(20) NOT NULL DEFAULT 'manual',   -- 'manual' | 'scheduled'
  actor_id      VARCHAR(64),
  filename      VARCHAR(255) NOT NULL,
  size_bytes    BIGINT,
  record_counts JSONB,                                   -- { users, groups, donations, ... }
  checksum      VARCHAR(64),                             -- SHA-256 of the payload
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_created ON backups (created_at DESC);
