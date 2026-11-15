#!/bin/bash
# Copies Steve's chat page, rule checker, learning job and instructions from this repo to the Blink and restarts
# his page. Run from the NUC:  bash agents/steve-web/deploy.sh      (Tailscale SSH; no keys or passwords involved)
# The lessons Steve has learned live on the Blink; "learn.py --apply" puts them back on top of the new SOUL.md.
set -e
cd "$(dirname "$0")"
B=aaronlewis@100.70.128.45
python -m unittest test_rules.py
scp -q -o BatchMode=yes server.py rules_check.py prices.py index.html icon.svg manifest.webmanifest \
  trick-questions.json run_trick_questions.py learn.py askmic.js patch_console_web.py SOUL.md "$B:steve-web/"
scp -q -o BatchMode=yes steve-web.service business-model.service steve-learn.service steve-learn.timer "$B:.config/systemd/user/"
ssh -o BatchMode=yes "$B" 'python3 ~/steve-web/learn.py --apply && chmod 600 ~/.hermes/profiles/business/SOUL.md \
  && python3 -m py_compile ~/steve-web/server.py && systemctl --user daemon-reload \
  && systemctl --user enable --now steve-learn.timer >/dev/null 2>&1 \
  && systemctl --user restart steve-web && sleep 2 && systemctl --user is-active steve-web \
  && curl -s -m 5 http://127.0.0.1:8651/api/health'
echo
