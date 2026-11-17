#!/bin/sh
# Pulls Lab updates that Aaron merged into main on GitHub. Page changes show on the next reload;
# the server restarts only when its own code changed.
set -e
cd /srv/lab/app
before=$(git rev-parse HEAD)
git pull --ff-only --quiet origin main
after=$(git rev-parse HEAD)
[ "$before" = "$after" ] && exit 0
echo "Lab updated $before -> $after"
if ! git diff --quiet "$before" "$after" -- lab-app/server lab-app/package.json lab-app/package-lock.json; then
  (cd lab-app && npm ci --omit=dev --no-audit --no-fund)
  sudo /bin/systemctl restart lab
fi
