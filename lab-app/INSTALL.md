# Installing the Lab on the server

Hardware: Dell OptiPlex 7080 Micro (runs the Lab) + Synology DS225+ (holds the files). Reach: Tailscale only.
Time: about an hour. Steps marked **Aaron** need him at the keyboard (sign-ins, keys, OKs); everything else Claude can do over Remote Control.

## 1. The OptiPlex
1. **Aaron:** install Ubuntu Server 24.04 LTS from a USB stick (defaults; tick "Install OpenSSH server"; user `aaron`).
2. `sudo apt update && sudo apt full-upgrade -y && sudo reboot`

## 2. The Synology (DSM)
1. **Aaron:** finish DSM setup, storage pool SHR on both drives, Btrfs volume.
2. Create shared folders `lab-files`, `lab-video`, `lab-3d`, `lab-art`, `lab-backups` (Control Panel › Shared Folder). Turn on the recycle bin for each.
3. Control Panel › File Services › NFS: enable NFSv4.1. For each share, NFS Permissions › Create: host = the OptiPlex's LAN address, Read/Write, squash "Map all users to admin", allow non-privileged ports.
4. Snapshot Replication: schedule hourly snapshots on all five shares, keep 14 days.

## 3. Mount the shares on the OptiPlex
```
sudo mkdir -p /mnt/nas/{lab-files,lab-video,lab-3d,lab-art,lab-backups}
for s in lab-files lab-video lab-3d lab-art lab-backups; do
  echo "SYNOLOGY-IP:/volume1/$s /mnt/nas/$s nfs4 defaults,_netdev,noatime 0 0" | sudo tee -a /etc/fstab
done
sudo mount -a && df -h | grep nas
```

## 4. Install the Lab
```
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Adub843/creative-lab-engine/main/lab-app/deploy/install.sh)"
```
The first run prints a key. **Aaron:** add it at GitHub › creative-lab-engine › Settings › Deploy keys (read-only), then run the line again.
(If the repo is private, copy `deploy/install.sh` over instead of using curl.)

## 5. Settings and keys
1. `sudo nano /etc/lab/lab.config.json`: the Tailscale address as `origin`, the Cloudflare account id, Alice's address on the Blink.
2. **Aaron:** `sudo nano /etc/lab/lab.env` and type the Cloudflare API token (Cloudflare › My Profile › API Tokens › Create: Queues Edit + Workers R2 Storage Edit on his account). Never paste it in chat.
3. **Aaron:** `sudo -u lab -H claude` once and sign in to his Claude plan (Stacy's shifts and the fallback for questions use it).
4. Stacy's key: `cd /srv/lab/app/lab-app && sudo -u lab npm run agent-key -- stacy aaron db,assets`, then **Aaron** puts it in `/etc/lab/lab.env` as `LAB_AGENT_KEY`.

## 6. Start it
```
sudo tailscale up                      # Aaron signs in
sudo systemctl start lab lab-backup.timer lab-update.timer
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
systemctl status lab --no-pager
```

## 7. Each device (PC, phone, Shana's, Josh's)
1. Tailscale on, signed in.
2. At the server: `cd /srv/lab/app/lab-app && sudo -u lab npm run setup-code -- aaron` (or `shana`, `josh`). Good for 30 minutes, once.
3. On the device open `https://<server>.<tailnet>.ts.net/_lab/login#setup`, type the code, confirm with face/fingerprint/PIN.
4. Install as an app: Chrome/Edge on the PC: the install icon in the address bar. iPhone: Share › Add to Home Screen. Android: menu › Install app.

## Updates and backups
- Lab changes are made in GitHub; once **Aaron** merges them into `main`, the server picks them up within 5 minutes.
- Database copies: hourly to `lab-backups` (14 days), plus the Synology's own hourly snapshots of every share.
- Offsite (suggested): Synology Hyper Backup or Cloud Sync to an R2 bucket nightly.
- A small UPS for the OptiPlex and Synology avoids corrupting anything in a power cut.
