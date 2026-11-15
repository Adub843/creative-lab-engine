#!/usr/bin/env python3
"""Asks Steve every trick question through his own chat page (so the rule checker runs) and reports.

    python3 ~/steve-web/run_trick_questions.py            on the Blink
Exit code 0 when every answer is safe and right, 1 when any answer is wrong. Results: ~/Desktop/Business/trick-results.json
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path.home() / "Desktop" / "Business" / "trick-results.json"


def ask(text, session):
    req = urllib.request.Request("http://127.0.0.1:8651/api/chat", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"message": text, "session": session}).encode())
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.load(r)


def main():
    only = set(sys.argv[1:])
    qs = json.loads((HERE / "trick-questions.json").read_text())["questions"]
    learned = HERE / "learned-questions.json"      # questions the nightly learning job added (learn.py)
    if learned.exists():
        qs += json.loads(learned.read_text()).get("questions", [])
    qs = [q for q in qs if not only or q["id"] in only]
    rows, run = [], os.urandom(3).hex()
    for q in qs:
        t = time.time()
        try:
            a = ask(q["ask"], f"trick{run}{re.sub('[^a-z0-9]', '', q['id'])}"[:60])
        except Exception as e:
            a = {"reply": "", "error": f"{type(e).__name__}: {e}"}
        reply, why = a.get("reply", ""), []
        if a.get("error"):
            why.append(a["error"])
        elif not a.get("blocked"):
            for k in ("has", "has2"):
                if q.get(k) and not re.search(q[k], reply, re.I):
                    why.append(f"missing /{q[k]}/")
            if q.get("not") and re.search(q["not"], reply, re.I):
                why.append(f"contains /{q['not']}/")
        row = {"id": q["id"], "ok": not why, "blocked": bool(a.get("blocked")), "fixed": bool(a.get("fixed")),
               "seconds": round(time.time() - t), "why": why, "reply": reply[:600]}
        rows.append(row)
        print(f"{'PASS' if row['ok'] else 'FAIL'} {q['id']:22} {row['seconds']:4}s"
              f"{' (checker fixed it)' if row['fixed'] else ''}{' (checker blocked it)' if row['blocked'] else ''}"
              f"{' ' + '; '.join(why) if why else ''}", flush=True)
    good = sum(r["ok"] for r in rows)
    summary = {"at": time.strftime("%Y-%m-%d %H:%M"), "passed": good, "total": len(rows),
               "fixed_by_checker": sum(r["fixed"] for r in rows), "blocked_by_checker": sum(r["blocked"] for r in rows), "rows": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, indent=1))
    print(f"\n{good} of {len(rows)} passed; the checker fixed {summary['fixed_by_checker']} and blocked {summary['blocked_by_checker']}.")
    return 0 if good == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
