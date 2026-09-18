#!/usr/bin/env bash
# AL-AYN — deploy / redeploy from your Mac to the VPS.
# Usage (from the repo root):  bash deploy/deploy.sh
#
# Copies exactly what is in this folder (commit first!), installs backend
# dependencies on the server, restarts the API and checks it is healthy.
# First time only: afterwards run  ssh sinan-vps bash /opt/al-ayn/deploy/setup-server.sh
set -euo pipefail

HOST=${DEPLOY_HOST:-sinan-vps}
APP=/opt/al-ayn
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "[WARN] Uncommitted changes — they will be deployed but are not saved in git."
fi

echo "=== [1/4] Frontend ==="
ssh "$HOST" "mkdir -p $APP/frontend/css $APP/frontend/js $APP/frontend/icons $APP/backend $APP/deploy"
rsync -az --chmod=D755,F644 \
  index.html favicon.svg logo.png manifest.json "$HOST:$APP/frontend/"
rsync -az --delete --chmod=D755,F644 css/ "$HOST:$APP/frontend/css/"
rsync -az --delete --chmod=D755,F644 icons/ "$HOST:$APP/frontend/icons/"
rsync -az --delete --chmod=D755,F644 --exclude=vendor/ js/ "$HOST:$APP/frontend/js/"

echo "=== [2/4] Backend + deploy files ==="
rsync -az --delete --chmod=D755,F644 --exclude=node_modules --exclude=.env backend/ "$HOST:$APP/backend/"
rsync -az --delete --chmod=D755,F644 deploy/ "$HOST:$APP/deploy/"

echo "=== [3/4] Install dependencies ==="
ssh "$HOST" "cd $APP/backend && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

echo "=== [4/4] Restart + health check ==="
ssh "$HOST" "if systemctl list-unit-files al-ayn.service >/dev/null 2>&1 && systemctl is-enabled al-ayn >/dev/null 2>&1; then
  systemctl restart al-ayn && sleep 3 && curl -fsS http://127.0.0.1:7860/health && echo
else
  echo '[INFO] Service not installed yet — run: ssh $HOST bash $APP/deploy/setup-server.sh'
fi"
