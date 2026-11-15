#!/usr/bin/env python3
"""Brings the console's System map (the Business and Network maps) up to date with the setup of 2026-11-15.
Runs on the Blink against ~/console-web/static/js/livemap.js. Safe to run again; one dated backup is kept.

    python3 ~/steve-web/patch_console_map.py

What changes on the maps:
- Network: the Dell is a live server (not "planned"), the GMKtec is added, the Blink shows Alice and Steve on one
  shared model, the NUC shows what it now runs, Cloudflare says it keeps the public part on purpose, and the
  NUC-to-Dell backup line is drawn.
- Business: Steve, the business agent, gets his own circle next to Alice.
"""
import shutil
import sys
from pathlib import Path

P = Path.home() / "console-web" / "static" / "js" / "livemap.js"
MARK = "/* map updated 2026-11-15 */"
s = P.read_text(encoding="utf-8")
if MARK in s:
    print("already up to date")
    sys.exit(0)

missing = []


def swap(old, new):
    global s
    if old not in s:
        missing.append(old[:70])
        return
    s = s.replace(old, new, 1)


# ---------------- Network map ----------------
swap('{id:"dell",c:"plan",x:860,y:790,r:44,label:"Dell NAS",role:"planned",what:"Planned: ZimaOS NAS behind a pfSense box. It shows here once it\'s set up.",planned:true},',
     '{id:"dell",c:"lan",x:860,y:790,r:48,label:"Dell server",role:"192.168.1.221 · ZimaOS",what:"Your home server. Movies, Photos and Files shares, Jellyfin and Immich. It holds the nightly backups of every PC and the copy of the E: drive. A firewall box in front of it is still planned.",url:"http://192.168.1.221"},')
swap('what:"The Beelink running Alice (Qwen in LM Studio). Her chat is private to your tailnet.",url:"https://blink.tailb3d313.ts.net/"},',
     'what:"The Beelink that runs both agents, Alice (your assistant) and Steve (the business agent), on one shared Qwen model, plus the console copy and the team board. Only one model is kept loaded here.",url:"https://blink.tailb3d313.ts.net/"},\n'
     '      {id:"k15",c:"pc",x:1420,y:470,r:46,label:"GMKtec",role:"100.99.149.38",what:"The small-jobs PC. One Qwen 4B model: the backup for the daily brief. No chat agent runs here, it is too slow for that."},')
swap('what:"Your main PC. It sends the heartbeat that keeps this map live, runs the PC tasks and the E: drive tunnel.",tasks:"pc"},',
     'what:"The control desk. It sends the heartbeat that keeps this map live and runs the daily brief, the nightly backup to the Dell, the rules sync to the agents, your Documents page and the E: drive tunnel.",url:"https://nuc-skull.tailb3d313.ts.net:8446/",tasks:"pc"},')
swap('what:"Hosts the Creative Lab engine and the tunnel that serves your E: drive to the console.",url:"https://dash.cloudflare.com"},',
     'what:"Hosts the public part: the Creative Lab engine your shirt app reads, and the tunnel that serves your E: drive. Kept here on purpose (your choice, Nov 15) so it stays up when the house does not. Private things live on the Dell.",url:"https://dash.cloudflare.com"},')
swap('what:"Your private network. Your phone, the NUC and the Blink reach each other through it.",url:"https://login.tailscale.com/admin/machines"},',
     'what:"Your private network. Your phone, the NUC, the Blink, the GMKtec and the Dell reach each other through it from anywhere.",url:"https://login.tailscale.com/admin/machines"},')
swap('what:"Your data drive on the NUC. Never reformat it.",goto:"library"},',
     'what:"Your data drive on the NUC. Never reformat it. A full copy is being kept on the Dell server.",goto:"library"},')
swap('["gateway","dell","planned","plan"],', '["gateway","dell","","lan"],["nuc","dell","backups","pc"],')
swap('["tsnet","blink","","ts"],', '["tsnet","blink","","ts"],["tsnet","k15","","ts"],')

# ---------------- Business map ----------------
swap('label:"Alice",role:"Qwen · Blink",what:"Your local model on the Blink. She takes over Alice\'s work later.",url:"https://blink.tailb3d313.ts.net/",net:"blink"},',
     'label:"Alice",role:"Assistant · Blink",what:"Your personal assistant on the Blink: mail, calendar, notes and the Ask box. Her data is private and never reaches Steve.",url:"https://blink.tailb3d313.ts.net/talk",net:"blink"},\n'
     '      {id:"steve-agent",c:"pc",x:890,y:770,r:40,label:"Steve",role:"Business agent · Blink",what:"The business agent for both brands. He drafts and answers only. Every answer is rule-checked in code, prices come live from the stores, and he learns from his mistakes each night.",url:"https://blink.tailb3d313.ts.net:8444/",net:"blink"},')
swap('["pc","alice","","pc"]', '["pc","alice","","pc"],["alice","steve-agent","team board","pc"]')

if missing:
    print("NOT FOUND, nothing was changed:")
    for m in missing:
        print("  ", m)
    sys.exit(1)
bak = P.with_name(P.name + ".bak-map-2026-11-15")
if not bak.exists():
    shutil.copy2(P, bak)
P.write_text(MARK + "\n" + s, encoding="utf-8")
print("map updated: Dell live, GMKtec added, Steve added, 6 descriptions refreshed")
