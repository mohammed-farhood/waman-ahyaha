-- Migration 0003: Immutable audit log
-- Revoke delete/update on audit_logs from the app user so records can never be erased.
-- Run this AFTER the app user exists.
-- The app connects as the role that runs the migrations, so revoke from that role.
DO $$
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON audit_logs FROM %I', current_user);
END
$$;
