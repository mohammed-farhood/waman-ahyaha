#!/usr/bin/env bash
# Create / update the superadmin account(s) on the server from the
# SUPERADMIN_* values in /etc/waman-ahyaha/waman-ahyaha.env. Idempotent: re-running
# resets the PIN, which is also how you recover a forgotten password.
#   ssh sinan-vps bash /opt/waman-ahyaha/deploy/bootstrap-superadmin.sh
set -euo pipefail
cd /opt/waman-ahyaha/backend
sudo -u waman node --env-file=/etc/waman-ahyaha/waman-ahyaha.env scripts/bootstrap-superadmin.js
