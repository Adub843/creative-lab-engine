"""Web search for Alice, done in code so the small model cannot skip it (Aaron, 2026-11-15).

When a message looks like something to look up (places, prices, stores, news, how-to), alice-web runs the search
itself and hands Alice the results with the question. She then answers from real pages and real links.

Privacy: only the search words leave the Blink. Emails, phone numbers and street addresses are stripped from them
first, and nothing from Aaron's mail, calendar or notes is ever put in a search.
"""
import glob
import json
import os
import re
import subprocess

_PY = None
WORKER = r'''
import json, sys
from ddgs import DDGS
out = []
try:
    for r in DDGS().text(sys.argv[1], max_results=int(sys.argv[2])):
        out.append({"title": r.get("title", ""), "url": r.get("href", ""), "text": r.get("body", "")})
except Exception as e:
    out = {"error": str(e)[:200]}
print(json.dumps(out))
'''

# Things to look up on the web...
LOOKUP_RE = re.compile(
    r"\b(find|look ?up|search|google|where (?:can|do|is|are|to)|near(?:by| me)?|closest|nearest|price|prices|cost|how much|"
    r"cheap\w*|deal|deals|buy|sell|store|stores|shop|shops|shopping|market\w*|restaurant\w*|food|eat|coffee|hotel\w*|gas|"
    r"antique\w*|thrift|pawn|places?|things to do|good spots?|recommend\w*|best|review\w*|rating\w*|hours|open (?:now|today|late)|"
    r"address|directions|weather|forecast|news|score|who (?:is|was|won)|what(?:'s| is| are| was) (?:the|a|an)\b|when (?:is|does|did)|"
    r"how (?:do|to|does|long|far|many)|compare|versus|vs\.?|specs?|release date|in stock)\b", re.I)
# ...unless it is about his own mail, calendar, notes or the team, which are not on the web.
PRIVATE_RE = re.compile(r"\b(my )?(e-?mail|inbox|gmail|calendar|schedule|appointment|meeting|remind\w*|note|notes|to-?do|task|tasks|"
                        r"tell the team|steve|password|bank|account)\b", re.I)
SCRUB = [re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
         re.compile(r"(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b"),
         re.compile(r"\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Ct|Court|Way)\b\.?")]
FILLER = re.compile(r"^(?:hey|hi|hello|ok|okay|so|well|alice|girl|please|um+|uh+|yeah|but|and|oh)[\s,!.]+", re.I)
CHAT = re.compile(r"\b(?:how(?:'s| is) it going|how are you(?: doing)?(?: today)?|what'?s up|nothing much|can you|could you|would you|"
                  r"i was wondering(?: if)?|i want you to|i need you to|give me|tell me|show me|some results and|you know|maybe|just|really|"
                  r"while i'?m there|for me)\b", re.I)


# Things Aaron tells her about himself, or asks her to do or remember, are never sent to the web.
ABOUT_HIM_RE = re.compile(
    r"\b(remember|don'?t forget|keep in mind|for good|about me|my (?:favou?rite|wife|girlfriend|kids?|son|daughter|mom|dad|family|"
    r"doctor|health|address|birthday|job|boss|salary|pay|car|truck|phone|plans?)|what(?:'s| is| are| was) my|who is my|where is my|"
    r"when is my|do you (?:remember|know) (?:my|what i|that i)|i (?:like|love|hate|prefer)\b|"
    r"set (?:a|an|my)|remind|schedule|add (?:a|an|this|that|it)|save (?:a|this|that|it)|write (?:a|this|that|down)|send (?:a|an|this|that)|"
    r"draft|reply to|delete|cancel|turn (?:on|off))\b", re.I)


# Any real question about the world gets a search, not only the ones with a keyword from the list above.
# (2026-11-15: "what are some good concerts playing in Charleston in the next 2 months" was missed and handed off.)
QUESTION_RE = re.compile(
    r"\?\s*$|^\s*(?:hey |hi |ok |okay |so |well |and |alice[, ]+|please |can you |could you |would you )*"
    r"(?:what|where|when|which|who|whose|how|why|is there|are there|any|do you know|tell me|give me|show me|find|look|search|"
    r"recommend|suggest|list|name)\b|\b(?:what are|what is|what's|whats|any good|some good|where can|where to|how much|how many|"
    r"going on|happening|playing|coming up|events?|concerts?|shows?|tickets?|festival\w*|movies?|games?)\b", re.I)
# Talk about her, or plain small talk, is not a search.
SMALLTALK_RE = re.compile(
    r"\b(?:how are you|how(?:'s| is) it going|how you doing|what'?s up|who are you|what are you|what can you do|what do you (?:think|remember|know|do)|"
    r"are you (?:there|ok|okay|working|listening)|can you hear me|why did you|why can'?t you|why are you|thank you|thanks|good (?:morning|night|evening|afternoon)|"
    r"what did (?:i|you) (?:say|just)|say that again|repeat that|never ?mind)\b", re.I)


def needs_web(message):
    m = message or ""
    if PRIVATE_RE.search(m) or ABOUT_HIM_RE.search(m):
        return False
    # "hey how are you doing today, can you find ..." is a greeting AND a real question: judge what is left after the greeting.
    rest = SMALLTALK_RE.sub(" ", m)
    if len(rest.split()) < 3:
        return False
    return bool(LOOKUP_RE.search(rest) or QUESTION_RE.search(rest))


HOME_CITY = "Charleston, SC"   # the city only, which is already public on both stores
HERE_RE = re.compile(r"\b(?:in|around|near|by) (?:my|our) (?:neighbou?rhood|area|house|home|place)\b|\bnear me\b|\baround here\b|\bnearby\b", re.I)


def query_for(message):
    """The search words: the question without greetings, small talk or anything that identifies a person."""
    q = " ".join((message or "").split())
    q = HERE_RE.sub("in " + HOME_CITY, q)
    for rx in SCRUB:
        q = rx.sub(" ", q)
    for _ in range(4):
        q = FILLER.sub("", q)
    q = CHAT.sub(" ", q)
    q = re.sub(r"\s+", " ", q).strip(" ,.?!")
    return q[:160]


def _python():
    """Hermes's own Python that has the search package. Its folder name changes on updates, so it is found each start."""
    global _PY
    if _PY and os.path.exists(_PY):
        return _PY
    home = os.path.expanduser("~/.hermes/installs")
    for py in sorted(glob.glob(home + "/*/environments/*/venv/bin/python"), key=os.path.getmtime, reverse=True):
        try:
            if subprocess.run([py, "-c", "import ddgs"], capture_output=True, timeout=20).returncode == 0:
                _PY = py
                return py
        except Exception:
            pass
    return None


def search(query, n=6):
    py = _python()
    if not py or not query:
        return []
    try:
        r = subprocess.run([py, "-c", WORKER, query, str(n)], capture_output=True, text=True, timeout=25)
        rows = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return []
    if not isinstance(rows, list):
        return []
    return [x for x in rows if x.get("url", "").startswith("http")][:n]


STOP = set("a an the any some good great nice best really of to for in on at by with and or but is are was be can could would should "
           "i me my we our you your it its that this there their them they do does did have has had just maybe like know want "
           "where what which who how when while if so well also too very much many more most few little place places buy get find "
           "looking wondering wonder area around from about into out up".split())


def keywords(q):
    """The same search with the small words dropped, for when the full sentence finds nothing."""
    words = [x for x in re.findall(r"[A-Za-z0-9'&-]+", q) if x.lower() not in STOP]
    return " ".join(words[:12])


def prefix_for(message):
    """Text to put in front of Aaron's message: the results of a search run just now, or "" when none is needed."""
    if not needs_web(message):
        return ""
    q = query_for(message)
    rows = search(q)
    if not rows and keywords(q) and keywords(q) != q:      # a long spoken sentence can find nothing: try the key words
        q = keywords(q)
        rows = search(q)
    if not rows:                                           # the search service sometimes answers empty once
        import time
        time.sleep(1.5)
        rows = search(q)
    if not rows:
        return ("[A web search for this was tried just now and returned nothing. Say the search found nothing, "
                "and suggest better search words. Do not say you have no access to the web.]\n\n")
    lines = [f"{i}. {x['title'][:110]} | {x['text'][:260]} | {x['url']}" for i, x in enumerate(rows, 1)]
    return ("[Web search results, fetched just now for: \"" + q + "\"]\n" + "\n".join(lines) + "\n"
            "[Answer Aaron's question from these results. Name 2 to 4 specific places, prices or facts (use the store or place names that appear in the results, not just the list pages), each with its link "
            "copied exactly from above. Only use links from this list. If the results do not answer it, say what they do show. "
            "Never say you cannot access the web or local listings.]\n\n")


if __name__ == "__main__":
    import sys
    print(prefix_for(" ".join(sys.argv[1:])))
