"""Live prices for Steve: read from each store's public product feed, never typed in by hand.

The price sheet (its your_price column) is where Aaron changes shirt prices; the console syncs the sheet to the
Elevated Designs store every 15 minutes, and this file reads what the stores show. So a price changed on the
sheet or in Shopify reaches Steve by itself, within the cache time below. No key is needed: these feeds are the
same public pages a shopper sees. Each brand is read and kept separately.
"""
import json
import re
import threading
import time
import urllib.request

STORES = {
    "c3d": {"name": "Charleston3D", "base": "https://charleston3d.com"},
    "ed": {"name": "Elevated Designs", "base": "https://elevatedshirts.com"},
}
CACHE_SECONDS = 15 * 60
_cache = {}
_lock = threading.Lock()
PRICE_WORDS = re.compile(r"\b(price|prices|priced|pricing|cost|costs|how much|charge|quote|\$|dollars?|cheap|expensive|sale)\b", re.I)
STOP = set("a an the of for with and or to in on at by from our your my is are it this that how much does do what "
           "price prices cost costs charleston3d charleston 3d elevated designs shirt shirts tee tees".split())


def fetch_store(store, opener=urllib.request.urlopen):
    """[{title, url, prices: [..]}] for one store. Blank shirts for the builder are left out (thousands of sizes)."""
    base, out = STORES[store]["base"], []
    for page in range(1, 6):
        req = urllib.request.Request(f"{base}/products.json?limit=250&page={page}", headers={"User-Agent": "steve-prices"})
        with opener(req, timeout=20) as r:
            products = json.load(r).get("products", [])
        for p in products:
            if "builder-blank" in [t.lower() for t in (p.get("tags") or [])]:
                continue
            prices = sorted({round(float(v["price"]), 2) for v in p.get("variants", []) if v.get("price") not in (None, "")})
            if prices:
                out.append({"title": p.get("title", ""), "url": f"{base}/products/{p.get('handle', '')}", "prices": prices})
        if len(products) < 250:
            break
    return out


def products(store):
    """Cached product list for a store; an old copy is better than none if the store cannot be reached."""
    with _lock:
        hit = _cache.get(store)
        if hit and time.time() - hit["at"] < CACHE_SECONDS:
            return hit["items"]
    try:
        items = fetch_store(store)
    except Exception:
        return hit["items"] if hit else []
    with _lock:
        _cache[store] = {"at": time.time(), "items": items}
    return items


def allowed_prices(stores=("c3d", "ed")):
    return {p for s in stores for item in products(s) for p in item["prices"]}


def words(text):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in STOP and len(w) > 2}


def product_urls(stores=("c3d", "ed")):
    """Every real product page, so a made-up link can be told from a real one."""
    return {item["url"].lower() for s in stores for item in products(s)}


def price_note(asked, stores):
    return price_facts(asked, stores)[0]


def price_facts(asked, stores):
    """(note, prices): the lines handed to Steve with a price question (the matching products and their real
    prices) and exactly the prices in those lines. ("", None) when the message is not about price."""
    if not PRICE_WORDS.search(asked or ""):
        return "", None
    want, lines, shown = words(asked), [], set()
    for s in stores:
        items = products(s)
        scored = sorted(((len(want & words(i["title"])), i) for i in items), key=lambda x: -x[0])
        picked = [i for n, i in scored if n > 0][:8]
        if not picked:
            lines.append(f"{STORES[s]['name']}: no listed product matches that. Say the price is not listed"
                         + (" and that custom prints are quoted first." if s == "c3d" else "."))
            continue
        for i in picked:
            ps = i["prices"]
            shown.update(ps)
            price = f"${ps[0]:.2f}" if len(ps) == 1 else f"${ps[0]:.2f} to ${ps[-1]:.2f} by size or option"
            lines.append(f"{STORES[s]['name']}: {i['title']}: {price} ({i['url']})")
    return ("[Price list from the live store, read just now. These are the ONLY prices you may state, each for "
            "its own product. If the item is not here, say its price is not listed.]\n" + "\n".join(lines) + "\n\n"), shown
