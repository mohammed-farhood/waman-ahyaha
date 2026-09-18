-- Migration 0002: Performance indexes

CREATE INDEX idx_users_group       ON users(group_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_collector   ON users(collector_id) WHERE role = 'donor' AND deleted_at IS NULL;
CREATE INDEX idx_users_role_group  ON users(role, group_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_donations_month   ON donations(group_id, month_key);
CREATE INDEX idx_donations_paid    ON donations(group_id, month_key) WHERE paid = TRUE;
CREATE INDEX idx_donations_user    ON donations(user_id);
CREATE INDEX idx_ann_group_time    ON announcements(group_id, posted_at DESC);
CREATE INDEX idx_orphans_group     ON orphans(group_id);
CREATE INDEX idx_payreports_group  ON pay_reports(group_id, acknowledged);
CREATE INDEX idx_authcodes_created ON auth_codes(created_at);
CREATE INDEX idx_sessions_expires  ON sessions(expires_at);
CREATE INDEX idx_sessions_user     ON sessions(user_id);
CREATE INDEX idx_audit_actor       ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity      ON audit_logs(entity_type, entity_id, created_at DESC);
