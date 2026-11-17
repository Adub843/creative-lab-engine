#!/usr/bin/env python3
"""Posts one note to the team board from another machine or a script.

    echo "The rules file changed." | python3 ~/team-notes/post_note.py rules nuc

The kind is the first argument (lesson, aaron, rules, job, price), who it is from the second, and the text comes
on standard input so nothing has to be quoted on a command line. Prints "posted" or "skipped".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import team_notes  # noqa: E402

kind = sys.argv[1] if len(sys.argv) > 1 else ""
by = sys.argv[2] if len(sys.argv) > 2 else "code"
print("posted" if team_notes.add(kind, sys.stdin.read(), by=by) else "skipped")
