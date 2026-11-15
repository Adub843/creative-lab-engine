#!/bin/bash
# One-step install of the Lab on the server (Ubuntu Server 24.04 on the OptiPlex).
# Run once, as an admin: copy this file to the server, then  sudo bash install.sh   (the repo is private, so a raw link needs a sign-in)
# It never asks for or stores a password or key; those go in /etc/lab/lab.env, typed by Aaron.
set -euo pipefail
REPO=git@github.com:Adub843/creative-lab-engine.git
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

say "Node.js 22, git, Tailscale"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git nfs-common
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh

say "Lab user and folders"
id lab >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/lab --shell /usr/sbin/nologin lab
mkdir -p /srv/lab/data /srv/lab/runner /etc/lab
chown -R lab:lab /srv/lab

say "Lab code from GitHub (read-only deploy key)"
if [ ! -f /srv/lab/.ssh/id_ed25519 ]; then
  sudo -u lab mkdir -p /srv/lab/.ssh && sudo -u lab ssh-keygen -q -t ed25519 -N "" -C "lab-server read-only" -f /srv/lab/.ssh/id_ed25519
  sudo -u lab sh -c 'ssh-keyscan github.com >> /srv/lab/.ssh/known_hosts 2>/dev/null'
fi
if [ ! -d /srv/lab/app/.git ]; then
  if ! sudo -u lab git clone --quiet "$REPO" /srv/lab/app 2>/dev/null; then
    echo; echo "Add this key at https://github.com/Adub843/creative-lab-engine/settings/keys/new"
    echo "(title: Lab server, leave 'Allow write access' OFF), then run this installer again:"; echo
    cat /srv/lab/.ssh/id_ed25519.pub; exit 1
  fi
fi
cd /srv/lab/app/lab-app && sudo -u lab npm ci --omit=dev --no-audit --no-fund

say "Settings"
[ -f /etc/lab/lab.config.json ] || cp /srv/lab/app/lab-app/lab.config.example.json /etc/lab/lab.config.json
[ -f /etc/lab/lab.env ] || install -m 600 -o root -g root /srv/lab/app/lab-app/deploy/lab.env.example /etc/lab/lab.env
chmod 644 /etc/lab/lab.config.json

say "Services: the Lab, hourly database copies, updates from GitHub"
cp /srv/lab/app/lab-app/deploy/*.service /srv/lab/app/lab-app/deploy/*.timer /etc/systemd/system/
echo 'lab ALL=(root) NOPASSWD: /bin/systemctl restart lab' > /etc/sudoers.d/lab && chmod 440 /etc/sudoers.d/lab
systemctl daemon-reload
systemctl enable lab lab-backup.timer lab-update.timer

cat <<'NEXT'

Installed. What's left needs Aaron at the server:
  1. sudo tailscale up                         (sign in to Tailscale)
  2. sudo nano /etc/lab/lab.config.json        (origin, Cloudflare account id, Alice's address)
  3. sudo nano /etc/lab/lab.env                (type the Cloudflare token yourself)
  4. NAS shares mounted at /mnt/nas            (see INSTALL.md, step 3)
  5. sudo systemctl start lab lab-backup.timer lab-update.timer
  6. sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
  7. cd /srv/lab/app/lab-app && sudo -u lab npm run setup-code -- aaron
     then open https://<server>.<tailnet>.ts.net/_lab/login#setup on your phone and PC
NEXT
