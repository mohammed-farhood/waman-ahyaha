#!/usr/bin/env bash
# AL-AYN VPS Setup Script — Ubuntu 22.04
# Run as root on a fresh Hostinger VPS:
#   bash vps-setup.sh
set -euo pipefail

echo "=== [1/8] System update ==="
apt-get update && apt-get upgrade -y

echo "=== [2/8] Install dependencies ==="
apt-get install -y nginx postgresql-15 postgresql-contrib redis-server ufw git build-essential curl

echo "=== [3/8] Install Node 18 ==="
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "=== [4/8] Firewall ==="
ufw allow 22
ufw allow 80
# ufw allow 443  # Uncomment when domain + TLS is ready
ufw --force enable

echo "=== [5/8] PostgreSQL setup ==="
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
sudo -u postgres psql <<SQL
CREATE USER alayn_user WITH PASSWORD '${DB_PASS}';
CREATE DATABASE alayn_prod OWNER alayn_user;
GRANT ALL PRIVILEGES ON DATABASE alayn_prod TO alayn_user;
SQL
echo "[INFO] DB password: ${DB_PASS} — save this!"

# Confirm PG is localhost-only (should already be by default)
PG_CONF="/etc/postgresql/15/main/postgresql.conf"
grep -E "^#?listen_addresses" "$PG_CONF" || true
echo "[INFO] Confirm listen_addresses = 'localhost' in $PG_CONF"

echo "=== [6/8] Create app user + directories ==="
id -u alayn &>/dev/null || useradd -m -s /bin/bash alayn
mkdir -p /var/www/al-ayn/{frontend,backend}
mkdir -p /var/log/al-ayn
chown -R alayn:alayn /var/www/al-ayn /var/log/al-ayn

echo "=== [7/8] Nginx ==="
cp /root/nginx-al-ayn.conf /etc/nginx/sites-available/al-ayn
ln -sf /etc/nginx/sites-available/al-ayn /etc/nginx/sites-enabled/al-ayn
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx && systemctl enable nginx

echo "=== [8/8] PM2 startup ==="
pm2 startup systemd -u alayn --hp /home/alayn

echo ""
echo "=== DONE ==="
echo "DB password (alayn_user): ${DB_PASS}"
echo ""
echo "Next steps:"
echo "  1. Deploy code to /var/www/al-ayn/"
echo "  2. Create /var/www/al-ayn/backend/.env (see .env.example)"
echo "     Set DATABASE_URL=postgres://alayn_user:${DB_PASS}@localhost:5432/alayn_prod"
echo "  3. npm ci --omit=dev  (in /var/www/al-ayn/backend/)"
echo "  4. node scripts/bootstrap-superadmin.js"
echo "  5. pm2 start ecosystem.config.js && pm2 save"
echo "  6. Copy static files to /var/www/al-ayn/frontend/"
