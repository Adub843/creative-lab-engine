"""The team notes board: how the local agents stay in the loop with each other.

The agents (Alice, Steve) are not running all the time; each one only wakes when it is asked something. So they
cannot "call" each other. What works is one shared board that CODE writes to the moment something is learned,
and that every agent is handed at the top of its next question. A note written at 2:00:00 is in front of the
other agent on its very next answer, with no scan or schedule in between.

Who writes (always code, never a model on its own, so private things cannot leak in):
- Steve's rule checker, the moment it rejects an answer (kind "lesson").
- Aaron, by saying or typing "tell the team: ..." to any agent (kind "aaron").
- The NUC, when the rules or marketing file changes (kind "rules").
- Kinds "job" and "price" are reserved for the job runner and price changes; nothing posts them yet.

Business only. Alice's mail, calendar and personal notes never go on the board.

    import team_notes
    team_notes.add("lesson", "Asked for an Elevated Designs post, a made-up product link was used.", by="steve")
    prefix = team_notes.prefix_for(question_text)     # "" when there is nothing recent

File: ~/team-notes/notes.jsonl (one JSON object per line). Old notes drop off after MAX_AGE_DAYS.
"""
import datetime
import json
import os
import re
import threading
from pathlib import Path

BOARD = Path(os.environ.get("TEAM_NOTES_FILE") or (Path.home() / "team-notes" / "notes.jsonl"))
KINDS = ("lesson", "aaron", "rules", "job", "price")
MAX_AGE_DAYS = 14
MAX_SHOWN = 8
MAX_CHARS = 240
_lock = threading.Lock()

# A question is "business" when it is about the shops, their products or their marketing.
BUSINESS_RE = re.compile(r"charleston\s?3d|elevated\s?designs|shirt|tee\b|print|listing|product|price|order|customer|"
                         r"post\b|caption|instagram|facebook|etsy|shopify|store|shop\b|brand|ad\b|ads\b|marketing|quote|"
                         r"nameplate|design|console|rule\b|rules\b", re.I)
TELL_RE = re.compile(r"^\s*(?:hey\s+\w+[,.]?\s+)?(?:please\s+)?(?:tell|let|note for|message|update)\s+(?:the\s+|all\s+(?:the\s+)?)?"
                     r"(?:team|agents|everyone|everybody)(?:\s+know)?\s*(?:that|:|,|-)?\s*(.+)$", re.I | re.S)
# Things that must never be put on a shared board.
SECRET_RE = re.compile(r"password|passcode|api[ _-]?key|secret|token|\bssn\b|social security|routing|account number|"
                       r"\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,16}\b", re.I)


def now():
    return datetime.datetime.now().astimezone()


def clean(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:MAX_CHARS]


def add(kind, text, by="code"):
    """Put one note on the board. Returns the note, or None when it was refused (empty, a secret, or a repeat)."""
    text = clean(text)
    if kind not in KINDS or not text or SECRET_RE.search(text):
        return None
    note = {"at": now().isoformat(timespec="seconds"), "kind": kind, "by": clean(by)[:20], "text": text}
    with _lock:
        if any(n["text"] == text and n["kind"] == kind for n in read()[-40:]):
            return None                       # the same note again adds nothing
        BOARD.parent.mkdir(parents=True, exist_ok=True)
        with BOARD.open("a", encoding="utf-8") as f:
            f.write(json.dumps(note, ensure_ascii=False) + "\n")
    return note


def read():
    """Every note still young enough to matter, oldest first."""
    try:
        lines = BOARD.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    cutoff, out = now() - datetime.timedelta(days=MAX_AGE_DAYS), []
    for line in lines:
        try:
            n = json.loads(line)
            if datetime.datetime.fromisoformat(n["at"]) >= cutoff:
                out.append(n)
        except (ValueError, KeyError, TypeError):
            pass
    return out


def recent(limit=MAX_SHOWN):
    return read()[-limit:]


def told(text):
    """If Aaron's message is "tell the team: ...", the part to post; otherwise None."""
    m = TELL_RE.match(text or "")
    return clean(m.group(1)) if m and len(clean(m.group(1))) > 3 else None


def is_business(text):
    return bool(BUSINESS_RE.search(text or ""))


def prefix_for(question, always=False, limit=MAX_SHOWN):
    """The lines an agent is handed before a business question. "" when there are no notes or it is not business."""
    if not (always or is_business(question)):
        return ""
    notes = recent(limit)
    if not notes:
        return ""
    label = {"lesson": "Lesson", "aaron": "From Aaron", "rules": "Rules update", "job": "Job", "price": "Price"}
    lines = [f"- {label.get(n['kind'], 'Note')} ({n['at'][5:16].replace('T', ' ')}): {n['text']}" for n in notes]
    return ("[Team notes: what the other agents and Aaron have put on the shared board lately. Follow them. "
            "Do not repeat them back unless asked.]\n" + "\n".join(lines) + "\n\n")
