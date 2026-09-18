#!/usr/bin/env bash
# Waman Ahyaha Daily Backup
# Place at: /etc/cron.daily/waman-ahyaha-backup
# Make executable: chmod +x /etc/cron.daily/waman-ahyaha-backup
set -euo pipefail

DST=/var/backups/waman-ahyaha
mkdir -p "$DST"

TS=$(date +%Y%m%d_%H%M)
DUMP="$DST/waman_${TS}.dump"

# Dump as custom format (compressed, restorable via pg_restore)
sudo -u postgres pg_dump -Fc waman_prod > "$DUMP"

# Keep only last 7 days
find "$DST" -name 'waman_*.dump' -mtime +7 -delete

echo "[backup] ✓ $DUMP ($(du -sh "$DUMP" | cut -f1))"

# Optional: copy off-box
# Requires rclone configured: rclone copy "$DUMP" remote:waman-ahyaha-backups/
# Uncomment next line when rclone is set up:
# rclone copy "$DUMP" remote:waman-ahyaha-backups/ 2>/dev/null || true
