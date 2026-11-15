#!/bin/bash
# Copies Steve's chat page, rule checker and instructions from this repo to the Blink and restarts his page.
# Run from the NUC:  bash tools/steve-web/deploy.sh      (Tailscale SSH; no keys or passwords are involved)
set -e
cd "$(dirname "$0")"
B=aaronlewis@100.70.128.45
python -m unittest test_rules.py
scp -q -o BatchMode=yes server.py rules_check.py prices.py index.html icon.svg manifest.webmanifest trick-questions.json run_trick_questions.py "$B:steve-web/"
scp -q -o BatchMode=yes steve-web.service business-model.service "$B:.config/systemd/user/"
scp -q -o BatchMode=yes SOUL.md "$B:/tmp/steve-SOUL.md"
ssh -o BatchMode=yes "$B" 'install -m 600 /tmp/steve-SOUL.md ~/.hermes/profiles/business/SOUL.md && rm /tmp/steve-SOUL.md && python3 -m py_compile ~/steve-web/server.py && systemctl --user daemon-reload && systemctl --user restart steve-web && sleep 2 && systemctl --user is-active steve-web && curl -s -m 5 http://127.0.0.1:8651/api/health'
echo
