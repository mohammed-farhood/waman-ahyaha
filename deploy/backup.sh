#!/usr/bin/env bash
# AL-AYN Daily Backup
# Place at: /etc/cron.daily/al-ayn-backup
# Make executable: chmod +x /etc/cron.daily/al-ayn-backup
set -euo pipefail

DST=/var/backups/al-ayn
mkdir -p "$DST"

TS=$(date +%Y%m%d_%H%M)
DUMP="$DST/alayn_${TS}.dump"

# Dump as custom format (compressed, restorable via pg_restore)
sudo -u postgres pg_dump -Fc alayn_prod > "$DUMP"

# Keep only last 7 days
find "$DST" -name 'alayn_*.dump' -mtime +7 -delete

echo "[backup] ✓ $DUMP ($(du -sh "$DUMP" | cut -f1))"

# Optional: copy off-box
# Requires rclone configured: rclone copy "$DUMP" remote:al-ayn-backups/
# Uncomment next line when rclone is set up:
# rclone copy "$DUMP" remote:al-ayn-backups/ 2>/dev/null || true
