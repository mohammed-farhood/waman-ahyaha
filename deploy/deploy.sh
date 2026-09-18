#!/usr/bin/env bash
# AL-AYN Deploy / Redeploy Script
# Run from the VPS as user 'alayn' (or root adjusting paths).
# Usage:  bash deploy.sh
set -euo pipefail

REPO_URL="https://github.com/mohammed-farhood/AL-AYN.git"
APP_DIR="/var/www/al-ayn"
SRC_DIR="$APP_DIR/src"
FE_DIR="$APP_DIR/frontend"
BE_DIR="$APP_DIR/backend"

echo "=== [1/5] Clone / update repo ==="
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$SRC_DIR"
fi

echo "=== [2/5] Copy frontend ==="
rsync -av --delete \
  "$SRC_DIR/index.html" "$SRC_DIR/css/" "$SRC_DIR/js/" \
  "$SRC_DIR/favicon.svg" "$SRC_DIR/logo.png" "$SRC_DIR/manifest.json" \
  "$FE_DIR/"

echo "=== [3/5] Install backend deps ==="
rsync -av --delete --exclude=node_modules --exclude=.env \
  "$SRC_DIR/backend/" "$BE_DIR/"
cd "$BE_DIR" && npm ci --omit=dev

echo "=== [4/5] Reload API ==="
if pm2 list | grep -q al-ayn-api; then
  pm2 reload al-ayn-api
else
  cd "$BE_DIR" && pm2 start ecosystem.config.js && pm2 save
fi

echo "=== [5/5] Reload Nginx ==="
nginx -t && systemctl reload nginx

echo "=== Deploy complete ==="
curl -s http://localhost:7860/health || echo "[WARN] health check failed"
