-- AL-AYN Production Schema
-- Migration 0001: Initial tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- schema_migrations is created by db/runner.js (CREATE TABLE IF NOT EXISTS)
-- before any migration runs, so it must not be redeclared here.

CREATE TABLE groups (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  university             TEXT,
  icon                   TEXT,
  orphans_sponsored      INT  NOT NULL DEFAULT 0,
  cost_per_orphan        INT  NOT NULL DEFAULT 25000,
  monthly_goal           INT  NOT NULL DEFAULT 0,
  default_pledge         INT  NOT NULL DEFAULT 5000,
  telegram_bot_token_enc BYTEA,
  created_at             DATE NOT NULL DEFAULT CURRENT_DATE,
  deleted_at             TIMESTAMPTZ
);

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  phone_hash       TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL CHECK (role IN ('superadmin','admin','collector','donor')),
  pin_hash         TEXT,
  group_id         TEXT REFERENCES groups(id) ON DELETE SET NULL,
  collector_id     TEXT REFERENCES users(id)  ON DELETE SET NULL,
  amount           INT  DEFAULT 0,
  is_anonymous     BOOLEAN DEFAULT FALSE,
  join_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  stage            TEXT,
  availability     JSONB,
  telegram_chat_id BIGINT,
  failed_attempts  INT  NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

CREATE TABLE donations (
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  month_key    TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  paid         BOOLEAN NOT NULL DEFAULT FALSE,
  amount       INT  NOT NULL DEFAULT 0,
  paid_date    TIMESTAMPTZ,
  collector_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, month_key, user_id)
);

CREATE TABLE announcements (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orphans (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  name_enc      BYTEA NOT NULL,
  code          TEXT,
  province      TEXT,
  type          TEXT,
  amount        INT,
  birth_date_enc BYTEA,
  status        TEXT,
  notes_enc     BYTEA
);

CREATE TABLE campaign_requests (
  id         TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved   BOOLEAN DEFAULT FALSE
);

CREATE TABLE support_messages (
  id         TEXT PRIMARY KEY,
  from_user  TEXT,
  phone      TEXT,
  subject    TEXT,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved   BOOLEAN DEFAULT FALSE
);

CREATE TABLE pay_reports (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  reporter_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  donor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  month_key       TEXT NOT NULL,
  amount          INT,
  note            TEXT,
  acknowledged    BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          INET,
  ua          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_codes (
  code       TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'pending',
  chat_id    BIGINT,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  refresh_token_hash TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip                 INET,
  ua                 TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
