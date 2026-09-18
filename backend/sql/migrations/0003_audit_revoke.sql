-- Migration 0003: Immutable audit log
-- Revoke delete/update on audit_logs from the app user so records can never be erased.
-- Run this AFTER the app user exists.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'alayn_user') THEN
    REVOKE UPDATE, DELETE ON audit_logs FROM alayn_user;
  END IF;
END
$$;
