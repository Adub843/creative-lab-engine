#!/bin/bash
# Keeps Steve's model loaded. The Blink's graphics chip can drop a model under load (seen twice on 2026-11-15);
# this runs every five minutes from blink-health.timer, after the main health check, and loads it again.
export PATH=$HOME/.lmstudio/bin:/usr/local/bin:/usr/bin:/bin
curl -sf -m 10 http://127.0.0.1:1234/v1/models >/dev/null || exit 0     # LM Studio itself is down: the main check handles that
if ! lms ps 2>/dev/null | grep -q 'console-8b'; then
  echo "Steve's model (console-8b) is not loaded, loading it"
  systemctl --user restart business-model.service
fi
