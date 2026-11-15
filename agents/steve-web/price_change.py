"""Change a live price by asking Steve, in words or by voice. Code does every step; the model is never asked.

    Aaron:  "Change the price of the Charleston3D mini name desk plate to 21 dollars"
    Steve:  "Change Mini Name Desk Plate on charleston3d.com from $19.00 to $21.00? Say 'yes, change it' ..."
    Aaron:  "Yes, change it"
    Steve:  "Done. Mini Name Desk Plate is now $21.00 (was $19.00)."

Safety, in order:
- Only a product found in the live store's own product list can be changed, and only when exactly one product
  matches. Two matches: Steve asks which one.
- Nothing changes until Aaron confirms in the same chat within two minutes. Anything else he says cancels it.
- The change goes through the engine's Edit price action, which refuses shirts priced from the price sheet and
  products with different prices by size. Steve repeats the engine's reason.
- The console key is typed once by Aaron on the Blink (set-console-key.sh) and kept in ~/.config/steve/console.key.
  Without it Steve finds the product and says the key is not set; he never asks for the key in chat.
- Every change is posted to the team board and logged in ~/Desktop/Business/price-changes.jsonl.
"""
import datetime
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import prices
import rules_check

ENGINE = "https://creative-lab-engine.business-console.workers.dev"
KEY_FILE = Path.home() / ".config" / "steve" / "console.key"
LOG = Path.home() / "Desktop" / "Business" / "price-changes.jsonl"
CONFIRM_SECONDS = 120
PRICE_MIN, PRICE_MAX = 0.5, 5000.0
PENDING = {}            # chat session -> the change waiting for "yes, change it"

CMD_RE = re.compile(r"\b(?:change|set|update|make|raise|lower|drop|put|move)\s+(?:the\s+)?price\s+(?:of|for|on)\s+(?:the\s+|our\s+|my\s+)?(.+?)\s+"
                    r"(?:to|at)\s+\$?\s?(\d{1,4}(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd)?\s*[.!?]*\s*$", re.I)
CONFIRM_RE = re.compile(r"^\s*(?:yes|yep|yeah|ok|okay|confirm|do it|go ahead)[\s,.!]*(?:change it|do it|confirm|go ahead|please)?[\s.!]*$", re.I)
CANCEL_RE = re.compile(r"^\s*(?:no|nope|cancel|stop|never ?mind|don'?t)\b", re.I)


def money(n):
    return f"${float(n):,.2f}"


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


def read_key():
    try:
        k = KEY_FILE.read_text().strip()
        return k if len(k) >= 16 else None
    except OSError:
        return None


def engine_post(store, product_id, price, key, opener=urllib.request.urlopen):
    """Asks the engine to change the price. Returns its answer; raises ValueError with the engine's own reason."""
    req = urllib.request.Request(ENGINE + "/api/products", method="POST",
                                 data=json.dumps({"store": store, "id": f"gid://shopify/Product/{product_id}", "price": f"{price:.2f}"}).encode(),
                                 headers={"Content-Type": "application/json", "x-console-key": key, "User-Agent": "steve-price-change"})
    try:
        with opener(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            reason = json.load(e).get("error") or f"the engine answered {e.code}"
        except Exception:
            reason = f"the engine answered {e.code}"
        raise ValueError(reason)


def log_change(row):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
    except OSError:
        pass


def handle(asked, session, now=time.time, post=engine_post, key=read_key, note=None):
    """The reply when this message is part of a price change, else None (the message goes to the model as usual)."""
    waiting = PENDING.get(session)
    if waiting and now() - waiting["at"] > CONFIRM_SECONDS:
        PENDING.pop(session, None)
        waiting = None
    if waiting:
        PENDING.pop(session, None)
        if CONFIRM_RE.match(asked or ""):
            k = key()
            if not k:
                return "I can't change it: the console key is not set on the Blink any more. Nothing was changed."
            try:
                post(waiting["store"], waiting["id"], waiting["new"], k)
            except ValueError as e:
                return f"The store did not change. {e}"
            except Exception as e:
                return f"I could not reach the engine ({type(e).__name__}), so nothing was changed. Try again in a minute."
            row = {"at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "store": waiting["store"], "title": waiting["title"],
                   "url": waiting["url"], "was": waiting["old"], "now": waiting["new"], "by": "aaron, through Steve"}
            log_change(row)
            prices._cache.pop(waiting["store"], None)          # the next price question reads the new price
            if note:
                note("price", f"{waiting['title']} ({waiting['brand']}) changed from {money(waiting['old'])} to {money(waiting['new'])} by Aaron.")
            return (f"Done. {waiting['title']} is now {money(waiting['new'])} (was {money(waiting['old'])}). "
                    f"To undo, say: change the price of {waiting['title']} to {waiting['old']:.2f}.")
        if CANCEL_RE.match(asked or ""):
            return "Cancelled. Nothing was changed."
        # anything else: the waiting change is dropped and the new message is handled normally

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
    if not key():
        return (f"I found it: {item['title']} ({brand}) is {money(old)}. I can't change prices yet, because the console key has not "
                "been set on the Blink. Run \"Set console key for Steve\" on the Blink once, then ask me again. Nothing was changed.")
    PENDING[session] = {"at": now(), "store": store, "brand": brand, "id": item["id"], "title": item["title"], "url": item["url"], "old": old, "new": new}
    return (f"Change {item['title']} on {prices.STORES[store]['base'].split('//')[1]} from {money(old)} to {money(new)}? "
            "This changes the live store. Say \"yes, change it\" to confirm, or \"cancel\".")
