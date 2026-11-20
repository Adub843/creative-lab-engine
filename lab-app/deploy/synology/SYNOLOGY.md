# The Lab on the Synology DS225+

Aaron chose the Synology as the Lab's home (2026-11-20). The Lab runs as one Container Manager project,
reached only over Tailscale with passkey sign-in. Nothing is opened to the internet.
Steps marked **Aaron** need him; Claude does the rest from the NUC.

## 1. First-time setup (once the box is plugged into the router by cable and turned on)
1. Claude opens `https://find.synology.com` in Chrome on the NUC and starts DSM setup (latest DSM, SHR, Btrfs).
2. **Aaron** types the admin username and password when DSM asks (never in chat).
3. Claude installs from Package Center: **Container Manager**, **Tailscale**, **Hyper Backup**, **Text Editor**.
4. **Aaron** signs Tailscale in (one click on the link the package shows).

## 2. Folders
Shared folder `lab` with: `app`, `data`, `files`, `config`, `libraries/video`, `libraries/3d`, `libraries/art`.
Only the admin account gets read/write; turn the Recycle Bin on.

## 3. Code
On the NUC, in a clean clone of creative-lab-engine at `main`, copy `lab-app/` and `lab/` (the Lab's page files)
to `\\<synology>\lab\app\` with `robocopy /MIR` (skip `node_modules`). Repeat for each update, then restart the project.

## 4. Settings
- `config/lab.config.json`: from `lab-app/deploy/synology/lab.config.synology.json`. Fill in the Synology's
  Tailscale name (origin, port 8443) and the Cloudflare account id. Alice's address is the Blink's tailnet name.
- `config/lab.env`: from `lab-app/deploy/lab.env.example`. **Aaron** types `CF_API_TOKEN` (and `ANTHROPIC_API_KEY`
  if wanted) in Text Editor. Never in chat.

## 5. Start
- Container Manager > Project > Create > path `/volume1/lab/app/lab-app/deploy/synology` > use `docker-compose.yml` > Build.
- SSH (or Task Scheduler, run once as root): `tailscale serve --bg --https=8443 http://127.0.0.1:3000`
  (8443 so it can't clash with DSM's own 443).
- Setup code: Container Manager > lab > Terminal > `node server/admin.mjs setup-code aaron`.
  **Aaron** opens `https://<synology>.<tailnet>.ts.net:8443/_lab/login#setup` on his phone and PC, types the code,
  and saves the passkey. Then "Install app" / "Add to Home Screen".

## 6. Move the data
Follow `lab-app/MOVE.md` (freeze, page files, database, files, Stacy's shifts, check every page 3 times).
Stacy's shifts stay on claude.ai (`runner.enabled: false`) until the Claude command line is signed in on the box.

## 7. Backups
`lab-backup` copies the databases every hour to `data/backups`. Hyper Backup copies `lab/data` and `lab/files`
nightly to the USB drive (and optionally to Cloudflare R2).
