#!/usr/bin/env bash
# Create / update the superadmin account(s) on the server from the
# SUPERADMIN_* values in /etc/al-ayn/al-ayn.env. Idempotent: re-running
# resets the PIN, which is also how you recover a forgotten password.
#   ssh sinan-vps bash /opt/al-ayn/deploy/bootstrap-superadmin.sh
set -euo pipefail
cd /opt/al-ayn/backend
sudo -u alayn node --env-file=/etc/al-ayn/al-ayn.env scripts/bootstrap-superadmin.js
