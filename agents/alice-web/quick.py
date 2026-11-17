"""Alice's everyday actions done in code (Aaron, 2026-11-15: "all of these core actions ... need to be actual code").

Code answers these at once, with no model call: the time and date, simple maths, saving a note, listing notes.
Anything else returns None and goes on to the model. Nothing here leaves the Blink.
"""
import ast
import datetime
import operator
import os
import re
from zoneinfo import ZoneInfo

HOME_TZ = ZoneInfo("America/New_York")     # Aaron's home time zone
START = r"^\s*(?:hey |hi |ok |okay |so |alice[, ]+|please |can you |could you |would you )*"
TIME_RE = re.compile(START + r"(?:what(?:'?s| is)? ?(?:the )?time(?: is it)?(?: now| right now)?|what time is it(?: now| right now)?|"
                     r"what(?:'?s| is) (?:the |today'?s )?(?:date|day)(?: today| is it)?|what day is (?:it|today))\s*\??\s*$", re.I)
NOTE_RE = re.compile(START + r"(?:take|make|add|save|write|jot)(?: down)? (?:a |this |quick )*note(?: for me)?(?: that| to| saying)?[\s:,-]+(.+)$|" +
                     START + r"note(?: to self)?[\s:,-]+(.+)$", re.I | re.S)
NOTES_LIST_RE = re.compile(START + r"(?:show|list|read|what are|give me)(?: me)?(?: all)?(?: of)? (?:my |the )?(?:latest |recent |saved )?notes(?: and tasks)?\s*\??\s*$", re.I)
MATH_RE = re.compile(START + r"(?:what(?:'s| is)|calculate|compute|how much is)?\s*([-+*/().%\d\s,x×÷^]+?)\s*(?:=|\?)*\s*$", re.I)
PCT_RE = re.compile(START + r"(?:what(?:'s| is) )?(\d+(?:\.\d+)?)\s*(?:%|percent) of \$?([\d,]+(?:\.\d+)?)\s*\??\s*$", re.I)
SECRET_RE = re.compile(r"\b(password|passcode|pin|ssn|social security|routing|account number|card number|cvv|api key|token|secret)\b", re.I)
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
       ast.Pow: operator.pow, ast.Mod: operator.mod, ast.USub: operator.neg, ast.UAdd: operator.pos}


def _calc(node):
    if isinstance(node, ast.Expression):
        return _calc(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:
        a, b = _calc(node.left), _calc(node.right)
        if isinstance(node.op, ast.Pow) and (abs(a) > 1e6 or abs(b) > 12):
            raise ValueError("too big")
        return OPS[type(node.op)](a, b)
    if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:
        return OPS[type(node.op)](_calc(node.operand))
    raise ValueError("not arithmetic")


def _num(v):
    return f"{v:,.2f}".rstrip("0").rstrip(".") if isinstance(v, float) and not v.is_integer() else f"{int(v):,}"


def handle(message, save_note=None, read_notes=None, now=None):
    """A reply when code can do it, else None. save_note(entry) and read_notes() come from the page server."""
    m = (message or "").strip()
    if not m or len(m) > 600:
        return None
    if TIME_RE.match(m):
        t = (now or datetime.datetime.now(HOME_TZ)).astimezone(HOME_TZ)
        return f"It is {t.strftime('%I:%M %p').lstrip('0')} Eastern on {t.strftime('%A, %B')} {t.day}, {t.year}."
    got = PCT_RE.match(m)
    if got:
        pct, base = float(got.group(1)), float(got.group(2).replace(",", ""))
        return f"{_num(pct)}% of {_num(base)} is {_num(round(pct * base / 100, 2))}."
    got = MATH_RE.match(m)
    if got and re.search(r"\d\s*[-+*/x×÷^%]\s*\(?\d", got.group(1)):
        expr = got.group(1).replace(",", "").replace("×", "*").replace("x", "*").replace("÷", "/").replace("^", "**")
        try:
            v = _calc(ast.parse(expr.strip(), mode="eval"))
            return f"{got.group(1).strip()} = {_num(round(v, 6) if isinstance(v, float) else v)}"
        except Exception:
            return None
    got = NOTE_RE.match(m)
    if got and save_note:
        text = " ".join((got.group(1) or got.group(2) or "").split()).rstrip(".")
        if len(text) < 2:
            return None
        if SECRET_RE.search(text):
            return "I did not save that. Passwords, PINs and account numbers are never kept in my notes."
        t = (now or datetime.datetime.now()).astimezone()
        save_note({"id": t.strftime("%Y%m%d%H%M%S") + os.urandom(2).hex(), "when": t.strftime("%Y-%m-%d %H:%M"),
                   "at": t.isoformat(timespec="seconds"), "said": m, "kind": "note", "category": "note",
                   "title": text[:120], "status": "saved", "console": False})
        return f"Saved to your notes: {text}."
    if NOTES_LIST_RE.match(m) and read_notes:
        rows = [r for r in read_notes() if r.get("kind") in ("note", "task")][-12:]
        rows.reverse()
        if not rows:
            return "You have no saved notes or tasks yet."
        return "Your latest notes and tasks:\n" + "\n".join(
            f"- {r.get('when', '')[:10]} {'Task' if r.get('kind') == 'task' else 'Note'}: {r.get('title') or r.get('said', '')}" for r in rows)
    return None
