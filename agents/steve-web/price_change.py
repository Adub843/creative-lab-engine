"""Change a live price by asking Steve, in words or by voice. Code does every step; the model is never asked.

    Aaron:  "Change the price of the Charleston3D mini name desk plate to 21 dollars"
    Steve:  "Change Mini Name Desk Plate on charleston3d.com from $19.00 to $21.00? Say 'yes, change it' ..."
    Aaron:  "Yes, change it"
    Steve:  "Confirmed. It is being changed now ..."            (the NUC makes the change, usually within a minute)
    Aaron:  anything, a little later
    Steve:  "Price update: Mini Name Desk Plate is now $21.00 (was $19.00). ..."

No key ever lives on the Blink. Steve only writes a small request file; the NUC, which already holds the console
key, reads confirmed requests every minute, checks them again and asks the engine (scripts/price-requests.mjs).

Safety, in order:
- Only a product found in the live store's own product list can be changed, and only when exactly one product
  matches. Two matches: Steve asks which one.
- Nothing is requested until Aaron confirms in the same chat within two minutes. Anything else he says drops it.
- The NUC checks each request again: fresh (10 minutes), a sane price, and the live price still equals the "from"
  price Aaron was shown. Then the engine's Edit price action applies its own rules (it refuses shirts priced from
  the price sheet and products with different prices by size). Steve repeats the reason when it is refused.
- Every change is posted to the team board and logged in ~/Desktop/Business/price-changes.jsonl.

    python3 price_change.py list                     confirmed requests, as JSON (the NUC reads this)
    python3 price_change.py finish <id> done|failed   the outcome; the reason for a failure comes on standard input
"""
import datetime
import json
import os
import re
import sys
import time
from pathlib import Path

import prices
import rules_check

REQUESTS = Path.home() / "steve-web" / "price-requests"
LOG = Path.home() / "Desktop" / "Business" / "price-changes.jsonl"
CONFIRM_SECONDS = 120
REQUEST_MINUTES = 10
PRICE_MIN, PRICE_MAX = 0.5, 5000.0
PENDING = {}            # chat session -> the change waiting for "yes, change it"

CMD_RE = re.compile(r"\b(?:change|set|update|make|raise|lower|drop|put|move)\s+(?:the\s+)?price\s+(?:of|for|on)\s+(?:the\s+|our\s+|my\s+)?(.+?)\s+"
                    r"(?:to|at)\s+\$?\s?(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd)?\s*[.!?]*\s*$", re.I)
CONFIRM_RE = re.compile(r"^\s*(?:yes|yep|yeah|ok|okay|confirm|do it|go ahead)[\s,.!]*(?:change it|do it|confirm|go ahead|please)?[\s.!]*$", re.I)
CANCEL_RE = re.compile(r"^\s*(?:no|nope|cancel|stop|never ?mind|don'?t)\b", re.I)
STATUS_RE = re.compile(r"\b(?:did|has|is)\b.{0,40}\b(?:price|change|it)\b.{0,30}\b(?:go through|gone through|change[d]?|done|work(?:ed)?|finished|updated)\b", re.I)


def money(n):
    return f"${float(n):,.2f}"


def iso_now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def parse(text):
    """("mini name desk plate", 21.0) from a price-change sentence, else None."""
    m = CMD_RE.search(text or "")
    if not m:
        return None
    return m.group(1).strip(" \"'"), float(m.group(2))


def matches(query, stores):
    """Products whose title best matches the words asked for: [(store, item)], best score only."""
    want = prices.words(query)
    scored = []
    for s in stores:
        for item in prices.products(s):
            n = len(want & prices.words(item["title"]))
            if n:
                scored.append((n, s, item))
    if not scored:
        return []
    top = max(n for n, _, _ in scored)
    return [(s, item) for n, s, item in scored if n == top]


# ---------------- request files (the hand-off to the NUC) ----------------
def _read(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path, req):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(req, indent=1), encoding="utf-8")
    tmp.replace(path)


def all_requests():
    if not REQUESTS.is_dir():
        return []
    out = []
    for f in sorted(REQUESTS.glob("*.json")):
        r = _read(f)
        if r and re.fullmatch(r"[a-f0-9]{12}", str(r.get("id", ""))):
            out.append(r)
    return out


def file_request(waiting, session):
    rid = os.urandom(6).hex()
    req = {"id": rid, "session": session, "status": "confirmed", "at": iso_now(), "store": waiting["store"], "brand": waiting["brand"],
           "product_id": waiting["id"], "title": waiting["title"], "url": waiting["url"], "old": waiting["old"], "new": waiting["new"]}
    _write(REQUESTS / f"{rid}.json", req)
    return req


def finish(rid, outcome, reason="", note=None):
    """The NUC reports what happened. Logs and tells the team on success."""
    path = REQUESTS / f"{rid}.json"
    req = _read(path)
    if not req or req.get("status") != "confirmed" or outcome not in ("done", "failed"):
        return False
    req.update(status=outcome, finished=iso_now(), reason=re.sub(r"\s+", " ", reason or "").strip()[:300], reported=False)
    _write(path, req)
    if outcome == "done":
        try:
            LOG.parent.mkdir(parents=True, exist_ok=True)
            with LOG.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"at": req["finished"], "store": req["store"], "title": req["title"], "url": req["url"],
                                    "was": req["old"], "now": req["new"], "by": "Aaron, through Steve"}) + "\n")
        except OSError:
            pass
        if note:
            note("price", f"{req['title']} ({req['brand']}) changed from {money(req['old'])} to {money(req['new'])} by Aaron.")
    return True


def updates(session):
    """News for this chat about its own finished requests, told once. "" when there is none."""
    lines = []
    for req in all_requests():
        if req.get("session") != session or req.get("reported") is not False:
            continue
        if req["status"] == "done":
            lines.append(f"Price update: {req['title']} is now {money(req['new'])} (was {money(req['old'])}). "
                         f"To undo, say: change the price of {req['title']} to {req['old']:.2f}.")
            prices._cache.pop(req["store"], None)          # the next price question reads the new price
        elif req["status"] == "failed":
            lines.append(f"Price update: {req['title']} did NOT change. {req.get('reason') or 'The change could not be made.'}")
        req["reported"] = True
        _write(REQUESTS / f"{req['id']}.json", req)
    return ("\n".join(lines) + "\n\n") if lines else ""


def waiting_line(session):
    still = [r for r in all_requests() if r.get("session") == session and r.get("status") == "confirmed"]
    return f"{still[-1]['title']} is still being changed to {money(still[-1]['new'])}. It usually takes under a minute." if still else ""


# ---------------- the conversation ----------------
def handle(asked, session, now=time.time):
    """The reply when this message is part of a price change, else None (the message goes to the model as usual)."""
    waiting = PENDING.get(session)
    if waiting and now() - waiting["at"] > CONFIRM_SECONDS:
        PENDING.pop(session, None)
        waiting = None
    if waiting:
        PENDING.pop(session, None)
        if CONFIRM_RE.match(asked or ""):
            file_request(waiting, session)
            return (f"Confirmed. {waiting['title']} is being changed from {money(waiting['old'])} to {money(waiting['new'])} now. "
                    "It usually takes under a minute, and I'll tell you the result on your next message.")
        if CANCEL_RE.match(asked or ""):
            return "Cancelled. Nothing was changed."
        # anything else: the waiting change is dropped and the new message is handled normally

    if STATUS_RE.search(asked or "") and not parse(asked):
        line = waiting_line(session)
        if line:
            return line

    cmd = parse(asked)
    if not cmd:
        return None
    query, new = cmd
    if not (PRICE_MIN <= new <= PRICE_MAX):
        return f"I can only set a price from {money(PRICE_MIN)} to {money(PRICE_MAX)}. Nothing was changed."
    stores = sorted(rules_check.brands(asked)) or ["c3d", "ed"]
    found = matches(query, stores)
    if not found:
        return f'I could not find a product matching "{query}" on the live store. Say its name the way the store lists it. Nothing was changed.'
    if len(found) > 1:
        names = "; ".join(f"{item['title']} ({prices.STORES[s]['name']}, {money(item['prices'][0])})" for s, item in found[:5])
        return f"More than one product matches: {names}. Say the full name of the one you mean. Nothing was changed."
    store, item = found[0]
    brand = prices.STORES[store]["name"]
    if len(item["prices"]) > 1:
        return (f"{item['title']} has different prices by size or option ({money(item['prices'][0])} to {money(item['prices'][-1])}), "
                "so one price would overwrite them all. Change it in Shopify. Nothing was changed.")
    old = item["prices"][0]
    if abs(old - new) < 0.005:
        return f"{item['title']} is already {money(old)}. Nothing was changed."
    if not item.get("id"):
        return "I found the product but not its store id, so I can't change it. Nothing was changed."
    PENDING[session] = {"at": now(), "store": store, "brand": brand, "id": item["id"], "title": item["title"], "url": item["url"], "old": old, "new": new}
    return (f"Change {item['title']} on {prices.STORES[store]['base'].split('//')[1]} from {money(old)} to {money(new)}? "
            "This changes the live store. Say \"yes, change it\" to confirm, or \"cancel\".")


if __name__ == "__main__":
    sys.path.insert(0, str(Path.home() / "team-notes"))
    if sys.argv[1:2] == ["list"]:
        cutoff = datetime.datetime.now().astimezone() - datetime.timedelta(minutes=REQUEST_MINUTES)
        fresh = []
        for r in all_requests():
            if r.get("status") != "confirmed":
                continue
            if datetime.datetime.fromisoformat(r["at"]) < cutoff:
                finish(r["id"], "failed", "It waited more than 10 minutes without the NUC picking it up, so it was dropped. Nothing was changed.")
            else:
                fresh.append(r)
        print(json.dumps(fresh))
    elif sys.argv[1:2] == ["finish"] and len(sys.argv) == 4:
        try:
            import team_notes
            post = lambda kind, text: team_notes.add(kind, text, by="nuc")
        except Exception:
            post = None
        print("ok" if finish(sys.argv[2], sys.argv[3], sys.stdin.read(), note=post) else "ignored")
    else:
        print(__doc__)
        sys.exit(64)
