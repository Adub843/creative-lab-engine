"""Claude as Alice's brain (Aaron, 2026-11-15: "Option 1. Everything").

Alice keeps her page, her memory, her notes and her rules on the Blink. The thinking is done by a Claude model
through Aaron's own Anthropic key, which he types himself (set-claude-key.sh) and which only claude_worker.py reads.
If there is no key, or Claude cannot be reached, alice-web falls back to the local model, so she never goes silent.

Mail, calendar and reminders stay on her local tools (they need her Google sign-in), so those messages are not
routed here.
"""
import datetime
import json
import re
import subprocess
import threading
from pathlib import Path

HOME = Path.home()
KEY_FILE = HOME / ".config/alice/claude.env"
PY = HOME / "alice-web/venv/bin/python"
WORKER = Path(__file__).resolve().parent / "claude_worker.py"
SOUL = HOME / ".hermes/SOUL.md"
TIMEOUT = 240
KEEP = 24                     # messages of each conversation that are sent along

# Her Google tools live in the local agent, so these go there.
GOOGLE_RE = re.compile(r"\b(e-?mails?|inbox|gmail|calendar|appointments?|meetings?|remind\w*|my schedule|my agenda)\b", re.I)

PAGE = """

# How you are running right now
You are answering through Claude on Aaron's own key, from his private page on his own computer (the Blink).
- You have two live tools: web search and web fetch. Use them whenever a fact could have changed or you are not
  sure: places, prices, hours, events, news, scores, specs, how-to. Never say you cannot reach the web.
- Search words must never contain anything personal about Aaron or anyone else: no names, emails, phone numbers,
  street addresses, or facts from his notes. "Near me" means Charleston, SC unless he names another place.
- Give real names, real prices and real links copied from what you found. If you did not find it, say so.
- Never say you did something you did not do. In this path you cannot send mail, change his calendar or set a
  reminder; if he asks for one of those, say plainly that it needs his Google sign-in on the Blink.
- He usually listens to your answer out loud on his phone: lead with the answer, keep it short, plain sentences,
  no tables, no headings. Put each link on its own line after the thing it belongs to.
- "What Aaron asked you to remember" and the date and time are given at the top of his message. Trust them.
"""

_history = {}
_lock = threading.Lock()


def ready():
    return KEY_FILE.exists() and PY.exists() and WORKER.exists()


def wants(message):
    """True when this message should be answered by Claude."""
    return ready() and not GOOGLE_RE.search(message or "")


def system_text():
    try:
        soul = SOUL.read_text(encoding="utf-8")
    except Exception:
        soul = "You are Alice, Aaron's personal assistant. You are on his team: his information never leaves his systems."
    return soul.rstrip() + PAGE


def _now():
    try:
        from zoneinfo import ZoneInfo
        n = datetime.datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        n = datetime.datetime.now()
    return n.strftime("%A, %B %d, %Y, %I:%M %p Eastern").replace(" 0", " ")


def run_worker(payload):
    """One call to Claude. Returns {"reply": ...} or {"error": ...}. Replaced in tests."""
    try:
        r = subprocess.run([str(PY), str(WORKER)], input=json.dumps(payload), capture_output=True, text=True, timeout=TIMEOUT)
        return json.loads(r.stdout.strip().splitlines()[-1])
    except subprocess.TimeoutExpired:
        return {"error": "slow"}
    except Exception:
        return {"error": "worker"}


def ask(message, session, notes=""):
    """Alice's answer from Claude, or None when it could not be had (the caller then uses the local model)."""
    with _lock:
        past = list(_history.get(session, []))
    text = "[Now: " + _now() + "]\n" + (notes or "") + message
    out = run_worker({"system": system_text(), "messages": past + [{"role": "user", "content": text}]})
    reply = (out or {}).get("reply")
    if not reply:
        return None
    with _lock:
        h = _history.setdefault(session, [])
        h += [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]
        del h[:-KEEP]
        if len(_history) > 200:
            _history.pop(next(iter(_history)))
    return reply


def last_error(payload=None):
    """For the health page: a tiny call that says whether the key works. Never returns the key."""
    out = run_worker({"system": "Reply with the single word: ready", "messages": [{"role": "user", "content": "ping"}], "ping": True})
    return "ok" if out.get("reply") else out.get("error", "unknown")
