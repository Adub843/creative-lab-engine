#!/usr/bin/env python3
"""Steve's nightly learning job. Runs on the Blink with no one watching.

The model itself does not change. What grows is its instructions and its test set:

1. Read the answers the rule checker rejected since the last run (~/Desktop/Business/checker-log.jsonl).
2. Turn each new kind of mistake into a lesson (a line in Steve's instructions) and a new trick question.
3. Install the instructions with the new lessons and ask Steve every trick question again.
4. Keep the lessons only if the result held or got better. If it got worse, put the old instructions back.
5. Write ~/Desktop/Business/learning-report.json, which the daily brief reads.

    python3 ~/steve-web/learn.py            the nightly run (steve-learn.timer)
    python3 ~/steve-web/learn.py --apply    only rebuild the instructions from the base file and the kept lessons
                                            (deploy.sh runs this, so a deploy never drops what Steve has learned)

Pure functions are tested in test_rules.py; nothing here needs a key or leaves the Blink.
"""
import datetime
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUSINESS = Path.home() / "Desktop" / "Business"
LOG = BUSINESS / "checker-log.jsonl"
STATE = BUSINESS / "learning-state.json"          # kept lessons, learned questions, last score, log position
REPORT = BUSINESS / "learning-report.json"
RESULTS = BUSINESS / "trick-results.json"
LEARNED_Q = HERE / "learned-questions.json"       # read by run_trick_questions.py next to trick-questions.json
BASE = HERE / "SOUL.md"                           # the instructions from the repo, without lessons
SOUL = Path.home() / ".hermes" / "profiles" / "business" / "SOUL.md"
HEADING = "## Lessons from past mistakes"
MAX_LESSONS = 12
MAX_LEARNED_QUESTIONS = 30


def rule_of(problem):
    m = re.match(r"(Rule \d+)", problem or "")
    return m.group(1) if m else "Answer"


def short(text, n):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def lesson_key(asked, problem):
    return hashlib.sha1((rule_of(problem) + "|" + re.sub(r"[^a-z0-9 ]", "", (asked or "").lower())[:60]).encode()).hexdigest()[:10]


def lessons_from_log(rows, known=()):
    """New lessons from checker-log rows: one per (rule, kind of request), skipping ones already kept."""
    seen, out = {l["key"] for l in known}, []
    for r in rows:
        for p in r.get("first_problems", []):
            if p.startswith("That was a tool call"):
                continue                      # a model hiccup, not something an instruction fixes
            key = lesson_key(r.get("asked"), p)
            if key in seen:
                continue
            seen.add(key)
            what = re.sub(r"^Rule \d+: ", "", p)
            out.append({"key": key, "rule": rule_of(p), "asked": short(r.get("asked"), 140),
                        "text": f'Asked "{short(r.get("asked"), 90)}", you broke {rule_of(p).lower()}: {short(what, 150)}',
                        "at": r.get("at", "")})
    return out


def render(base, lessons):
    """The base instructions with the lessons section replaced (or removed when there are none)."""
    base = base.split("\n" + HEADING)[0].rstrip("\n") + "\n"
    if not lessons:
        return base
    lines = [f"- {l['text']}" for l in lessons[-MAX_LESSONS:]]
    return (base + HEADING + "\nReal mistakes you made before. Do not repeat them.\n" + "\n".join(lines) + "\n")


def learned_question(lesson):
    return {"id": "learned-" + lesson["key"], "ask": lesson["asked"], "learned": True}


def score(results):
    """(passed, not blocked, clean first try). Higher is better, compared left to right."""
    rows = results.get("rows", [])
    return [sum(1 for r in rows if r["ok"]), sum(1 for r in rows if not r["blocked"]),
            sum(1 for r in rows if r["ok"] and not r["fixed"] and not r["blocked"])]


def keep(new, old, new_total, old_total):
    """Keep the new lessons when nothing got worse: no new failures and no new blocks. The clean-first-try count
    may dip by one, because the model does not answer the same way twice."""
    if old is None:
        return new[0] == new_total
    new_fail, old_fail = new_total - new[0], old_total - old[0]
    new_block, old_block = new_total - new[1], old_total - old[1]
    return new_fail <= old_fail and new_block <= old_block and (new[2] - new_total) >= (old[2] - old_total) - 1


def load(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def run_tricks():
    subprocess.run([sys.executable, str(HERE / "run_trick_questions.py")], check=False, timeout=3 * 3600,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return load(RESULTS, {"rows": []})


def main():
    state = load(STATE, {"lessons": [], "questions": [], "score": None, "total": 0, "log_lines": 0})
    base = BASE.read_text(encoding="utf-8")
    if "--apply" in sys.argv:
        SOUL.write_text(render(base, state["lessons"]), encoding="utf-8")
        LEARNED_Q.write_text(json.dumps({"questions": state["questions"]}, indent=1))
        print(f"instructions rebuilt with {len(state['lessons'])} kept lessons")
        return 0

    lines = LOG.read_text().splitlines() if LOG.exists() else []
    rows = [json.loads(l) for l in lines[state.get("log_lines", 0):] if l.strip()]
    fresh = lessons_from_log(rows, state["lessons"])
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    report = {"at": now, "checked_answers": len(rows), "new_lessons": len(fresh), "kept": 0, "result": "", "line": ""}

    if not fresh and state["score"] is not None:
        state["log_lines"] = len(lines)
        report.update(result="nothing new", kept_total=len(state["lessons"]),
                      line=f"Steve: no new mistakes to learn from ({len(rows)} checked answers). {len(state['lessons'])} lessons kept so far.")
    else:
        cand_lessons = (state["lessons"] + fresh)[-MAX_LESSONS:]
        cand_questions = (state["questions"] + [learned_question(l) for l in fresh])[-MAX_LEARNED_QUESTIONS:]
        old_soul = SOUL.read_text(encoding="utf-8") if SOUL.exists() else render(base, state["lessons"])
        old_questions = LEARNED_Q.read_text() if LEARNED_Q.exists() else json.dumps({"questions": []})
        SOUL.write_text(render(base, cand_lessons), encoding="utf-8")
        LEARNED_Q.write_text(json.dumps({"questions": cand_questions}, indent=1))
        results = run_tricks()
        new, total = score(results), len(results.get("rows", []))
        ok = total > 0 and keep(new, state["score"], total, state.get("total", 0))
        if ok:
            state.update(lessons=cand_lessons, questions=cand_questions, score=new, total=total)
            report.update(kept=len(fresh), result="kept")
        else:
            SOUL.write_text(old_soul, encoding="utf-8")
            LEARNED_Q.write_text(old_questions)
            report.update(result="thrown away: the test result got worse")
        state["log_lines"] = len(lines)
        report.update(kept_total=len(state["lessons"]), passed=new[0], total=total, blocked=total - new[1], clean_first_try=new[2],
                      line=(f"Steve: {len(fresh)} new lesson{'s' if len(fresh) != 1 else ''} "
                            + ("kept" if ok else "tried and thrown away (the tests got worse)")
                            + f"; {new[0]} of {total} tests pass, {total - new[1]} blocked."))
    BUSINESS.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))
    REPORT.write_text(json.dumps(report, indent=1))
    print(report["line"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
