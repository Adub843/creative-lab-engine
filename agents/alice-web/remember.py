"""What Aaron asks Alice to remember, kept in code so it is really saved (Aaron, 2026-11-15).

The small model said "Saved." without saving. So "remember ..." is handled here: the fact is written to a private
file on the Blink, and every later question arrives with the list in front of it. Nothing here leaves the Blink,
and the list is never put into a web search.

  "Remember that my favorite gas station is Spinx"   -> saved
  "What do you remember about me?"                    -> the list
  "Forget the gas station"                            -> removes lines that mention it
"""
import datetime
import re
from pathlib import Path

FILE = Path.home() / "Desktop" / "Alice" / "remembered.md"
MAX_FACTS = 80
SAVE_RE = re.compile(r"^\s*(?:hey |ok |okay |alice[, ]+|please )*(?:remember|don'?t forget|keep in mind|note for good|make a note for good)\b"
                     r"(?: this)?(?: about me)?(?: for good)?(?: that)?[\s:,-]*(.+)$", re.I | re.S)
LIST_RE = re.compile(r"\bwhat do you (?:remember|know) about me\b|\bwhat have i (?:told|asked) you to remember\b|\bshow (?:me )?(?:what you|your) remember", re.I)
FORGET_RE = re.compile(r"^\s*(?:hey |ok |alice[, ]+|please )*forget (?:about |that |the |my )*(.+)$", re.I | re.S)
SECRET_RE = re.compile(r"\b(password|passcode|pin|ssn|social security|routing|account number|card number|cvv|api key|token|secret)\b", re.I)


def facts():
    try:
        return [l[2:].strip() for l in FILE.read_text(encoding="utf-8").splitlines() if l.startswith("- ")]
    except OSError:
        return []


def _write(items):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text("# What Aaron asked Alice to remember\n\n" + "".join(f"- {x}\n" for x in items[-MAX_FACTS:]), encoding="utf-8")
    try:
        FILE.chmod(0o600)
    except OSError:
        pass


def handle(message):
    """A reply when the message is a remember / forget / list request, else None."""
    m = (message or "").strip()
    got = SAVE_RE.match(m)
    if got and len(got.group(1).strip()) > 2 and not m.endswith("?"):
        fact = " ".join(got.group(1).split()).rstrip(".")
        if SECRET_RE.search(fact):
            return "I did not save that. Passwords, PINs and account numbers are never kept in my notes."
        items = facts()
        if fact.lower() not in (x.split(" (saved ")[0].lower() for x in items):
            items.append(f"{fact} (saved {datetime.date.today().isoformat()})")
            _write(items)
        return f"Saved. I will remember: {fact}."
    if LIST_RE.search(m):
        items = facts()
        return ("Here is what you asked me to remember:\n" + "\n".join(f"- {x}" for x in items)) if items else "You have not asked me to remember anything yet."
    got = FORGET_RE.match(m)
    if got:
        words = [w for w in re.findall(r"[a-z0-9']+", got.group(1).lower()) if len(w) > 2]
        items = facts()
        keep = [x for x in items if not (words and all(w in x.lower() for w in words))]
        if len(keep) == len(items):
            return "I have nothing saved that matches that."
        _write(keep)
        return f"Forgotten. I removed {len(items) - len(keep)} saved item(s)."
    return None


def prefix():
    items = facts()
    if not items:
        return ""
    return "[Things Aaron asked you to remember, from your saved notes. Use them when they help; never repeat them to anyone else:\n" + \
           "\n".join(f"- {x}" for x in items[-40:]) + "]\n\n"
