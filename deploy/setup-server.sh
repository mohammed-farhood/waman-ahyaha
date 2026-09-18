#!/usr/bin/env bash
# AL-AYN — one-time server setup on the Hostinger VPS (srv1956050).
# Run as root ON THE SERVER after deploy/deploy.sh has copied the code to /opt/al-ayn:
#   bash /opt/al-ayn/deploy/setup-server.sh
#
# Safe to re-run: every step skips work that is already done. It never
# regenerates secrets that exist (PG_ENC_KEY / PHONE_HMAC_KEY must never change).
#
# Assumes the server already has nginx, certbot, Postgres and Node 22 (it does).
set -euo pipefail
export LC_ALL=C.UTF-8

DOMAIN=al-ayn.srv1956050.hstgr.cloud
APP=/opt/al-ayn
ENV_FILE=/etc/al-ayn/al-ayn.env

echo "=== [1/6] System user + folders ==="
id alayn >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin alayn
mkdir -p "$APP" /etc/al-ayn /var/backups/al-ayn

echo "=== [2/6] Database ==="
if ! sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='alayn_user'" | grep -q 1; then
  DBP=$(openssl rand -hex 24)
  sudo -u postgres psql -q -c "CREATE ROLE alayn_user LOGIN PASSWORD '$DBP'"
  sudo -u postgres psql -q -c "CREATE DATABASE alayn_prod OWNER alayn_user"
  sudo -u postgres psql -q -d alayn_prod -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
  ( umask 077; echo "$DBP" > /etc/al-ayn/.dbpass )
fi

echo "=== [3/6] Environment file (secrets generated once, never rotated) ==="
if [ ! -f "$ENV_FILE" ]; then
  DBP=$(cat /etc/al-ayn/.dbpass)
  ( umask 027; cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://alayn_user:${DBP}@127.0.0.1:5432/alayn_prod
DB_SSL=false
JWT_SECRET=$(openssl rand -hex 48)
# PG_ENC_KEY and PHONE_HMAC_KEY are part of the data: NEVER change them.
PG_ENC_KEY=$(openssl rand -hex 32)
PHONE_HMAC_KEY=$(openssl rand -hex 32)
API_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=true
COOKIE_SAMESITE=Strict
CORS_ORIGIN=https://${DOMAIN}
TELEGRAM_BOT_TOKEN=
# Superadmins: fill in, then run: bash $APP/deploy/bootstrap-superadmin.sh
SUPERADMIN_PHONE_1=
SUPERADMIN_PIN_1=
SUPERADMIN_NAME_1=مدير التطبيق
SUPERADMIN_PHONE_2=
SUPERADMIN_PIN_2=
SUPERADMIN_NAME_2=مدير التطبيق 2
EOF
  )
  chgrp alayn "$ENV_FILE"
  echo "[INFO] Wrote $ENV_FILE — back up the four secrets in a password manager."
fi

echo "=== [4/6] systemd service ==="
install -m 644 "$APP/deploy/al-ayn.service" /etc/systemd/system/al-ayn.service
systemctl daemon-reload
systemctl enable --now al-ayn
sleep 3
curl -fsS http://127.0.0.1:7860/health && echo

echo "=== [5/6] TLS certificate + nginx ==="
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
fi
install -m 644 "$APP/deploy/nginx-al-ayn.conf" /etc/nginx/sites-available/al-ayn.conf
ln -sf /etc/nginx/sites-available/al-ayn.conf /etc/nginx/sites-enabled/al-ayn.conf
nginx -t && systemctl reload nginx

echo "=== [6/6] Daily database backup ==="
install -m 755 "$APP/deploy/backup.sh" /etc/cron.daily/al-ayn-backup

echo "=== DONE: https://$DOMAIN ==="
