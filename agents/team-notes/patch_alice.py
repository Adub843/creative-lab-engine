#!/usr/bin/env python3
"""Connects Alice (her phone page and the console's Ask box) to the team notes board. Runs on the Blink.

    python3 ~/team-notes/patch_alice.py   then   systemctl --user restart alice-web console-web

What it adds, and nothing else:
- Before a BUSINESS question, Alice is handed the latest team notes (Steve's lessons, Aaron's notes, rule updates).
  Personal questions are left exactly as they were.
- "Tell the team: ..." said or typed to Alice is posted to the board instead of being sent to the model.
Alice's own mail, calendar and notes are never written to the board. Safe to run again; each file gets one
dated backup before its first change. If team_notes.py is ever missing, Alice works exactly as before.
"""
import shutil
import sys
from pathlib import Path

HOME = Path.home()
STAMP = ".bak-team-notes-2026-11-15"
done, skipped, missing = [], [], []

IMPORT = '''
# ---- team notes board (agents/team-notes in the repo): shared with Steve; business only ----
import sys as _sys
_sys.path.insert(0, str(Path.home() / "team-notes"))
try:
    import team_notes
except Exception:                      # the board is optional: without it nothing changes
    class team_notes:                  # noqa: N801
        told = staticmethod(lambda text: None)
        add = staticmethod(lambda *a, **k: None)
        prefix_for = staticmethod(lambda *a, **k: "")
'''


def patch(path, marker, old, new):
    s = path.read_text(encoding="utf-8")
    rel = str(path.relative_to(HOME))
    if marker in s:
        skipped.append(f"{rel}: {marker[:44]}")
        return
    if old not in s:
        missing.append(f"{rel}: cannot find {old[:60]!r}")
        return
    bak = path.with_name(path.name + STAMP)
    if not bak.exists():
        shutil.copy2(path, bak)
    path.write_text(s.replace(old, new, 1), encoding="utf-8")
    done.append(f"{rel}: {marker[:44]}")


POSTED = '"Posted to the team board. Steve and I will both see it on our next answer: " + _t'
REFUSED = '"I did not post that: it is already on the board, or it looks like a password or key, which never goes there."'

# ---------------- Alice's own page (~/alice-web/server.py) ----------------
A = HOME / "alice-web" / "server.py"
patch(A, "import team_notes", "\ndef hermes_env():", IMPORT + "\n\ndef hermes_env():")
patch(A, "team_notes.prefix_for(message)",
      "def ask_alice(message, session):\n    env = hermes_env()",
      "def ask_alice(message, session):\n    message = team_notes.prefix_for(message) + message\n    env = hermes_env()")
patch(A, "_t = team_notes.told(text)",
      "def handle_talk(text, session):\n",
      "def handle_talk(text, session):\n    _t = team_notes.told(text)\n    if _t:\n"
      "        return {\"kind\": \"chat\", \"status\": \"chat\", \"reply\": (" + POSTED + ") if team_notes.add(\"aaron\", _t, by=\"aaron\") else " + REFUSED + "}\n")
patch(A, "_t = team_notes.told(message)",
      "        try:\n            self.send(200, {\"reply\": ask_alice(message, \"alice-web-\" + session)})",
      "        _t = team_notes.told(message)\n        if _t:\n"
      "            return self.send(200, {\"reply\": (" + POSTED + ") if team_notes.add(\"aaron\", _t, by=\"aaron\") else " + REFUSED + "})\n"
      "        try:\n            self.send(200, {\"reply\": ask_alice(message, \"alice-web-\" + session)})")

# ---------------- The console's Ask box (~/console-web/server.py) ----------------
C = HOME / "console-web" / "server.py"
patch(C, "import team_notes", "\ndef hermes_env():", IMPORT + "\n\ndef hermes_env():")
patch(C, "team_notes.prefix_for(message)",
      "def ask_alice(message, session=\"console\", timeout=900):\n    env = hermes_env()",
      "def ask_alice(message, session=\"console\", timeout=900):\n    message = team_notes.prefix_for(message) + message\n    env = hermes_env()")
# The console wraps the question as "<who> asks from the Lab console: <question>\n<how to answer>".
patch(C, "_t = team_notes.told(_q)",
      "                try:\n                    reply = ask_alice(msg, session=\"console-\"",
      "                _q = msg.split(\"asks from the Lab console: \", 1)[-1].split(\"\\n\", 1)[0]\n"
      "                _t = team_notes.told(_q)\n                if _t:\n"
      "                    return self.send(200, {\"reply\": (" + POSTED + ") if team_notes.add(\"aaron\", _t, by=\"aaron\") else " + REFUSED + "})\n"
      "                try:\n                    reply = ask_alice(msg, session=\"console-\"")

for title, rows in (("changed", done), ("already there", skipped), ("NOT FOUND", missing)):
    for r in rows:
        print(f"{title}: {r}")
sys.exit(1 if missing else 0)
