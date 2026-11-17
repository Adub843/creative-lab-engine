"""The rule checker for Steve, the business agent.

Code reads every answer before Aaron sees it. A rule that is only written in the model's instructions can be
forgotten or misquoted; a rule checked here holds either way. Each problem names its rule number in CLAUDE.md.

    problems = check(reply, asked, allowed_prices)

`asked` is Aaron's own message, `allowed_prices` is the set of prices from the live stores (prices.py).
Pure functions, no network: see test_rules.py.
"""
import re

C3D_RE = re.compile(r"charleston\s?3d|charleston3d\.com|#charleston3d", re.I)
ED_RE = re.compile(r"elevated\s?designs|elevatedshirts|elevated shirts|#elevateddesigns|epix3d", re.I)
# A request for something customers will read (a post, caption, listing, email, ad...), as opposed to a question.
DRAFT_RE = re.compile(r"\b(draft|write|caption|post|listing|description|email|ad copy|\bad\b|headline|tagline|bio|"
                      r"product page|newsletter|flyer|reply to)\b", re.I)
REFUSAL_RE = re.compile(r"separate|can(?:no|')t|cannot|one brand|not (?:allowed|able)|never appear|stay apart", re.I)
NEGATION_RE = re.compile(r"\b(never|not|no|don'?t|do not|avoid|without|isn'?t|aren'?t|won'?t|cannot|can'?t)\b", re.I)

EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍]+ ?")
PRICE_RE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{1,2})?)")
PER_DAY_RE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:a|per|each|every|/)\s*day", re.I)
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[-. ])?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d)")
STREET_RE = re.compile(r"\b\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s"
                       r"(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Hwy|Highway|Way|Ct|Court|Pkwy|Parkway)\b\.?")
PLACEHOLDER_RE = re.compile(r"\[[^\]\n]{0,60}\b(link|url|insert|your|name|price|tbd|placeholder|here|date|product|handle)\b[^\]\n]{0,60}\]"
                            r"|\blorem ipsum\b|\bexample\.com\b|\bXXX+\b|\bTBD\b|\{\{[^}]*\}\}", re.I)
DONE_RE = re.compile(r"\bI(?:\s+have|'ve|\s+just|\s+have\s+just|\s+already)?\s+"
                     r"(published|posted|sent|deployed|scheduled|uploaded|listed|emailed|messaged|launched|"
                     r"updated the (?:price|prices|listing|store|site)|changed the (?:price|prices)|paid|ordered|refunded)\b", re.I)
# Rule 21: his information and his customers' information never leave his systems.
LEAK_ASK_RE = re.compile(r"\b(sell|share|give|send|hand|export|upload|post|publish|forward|trade|rent)\b[^.?!\n]{0,80}"
                         r"\b(customers?|clients?|buyers?|subscribers?|shoppers?|aaron'?s?|mailing|email|contact)\b[^.?!\n]{0,60}"
                         r"\b(lists?|emails?|e-mails?|phones?|numbers?|addresses|info|information|data|details|contacts?|records?)\b", re.I)
LEAK_NO_RE = re.compile(r"\b(can(?:no|')t|cannot|won'?t|will not|never|not allowed|do not|don'?t|stays?|rule 21|no\b)", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
OWN_EMAIL_RE = re.compile(r"^hello@(charleston3d|elevatedshirts)\.com$", re.I)
SECRET_ASK_RE = re.compile(r"\b(send|give|share|tell|type|enter|provide|paste|what(?:'s| is))\b[^.?!\n]{0,40}"
                           r"\b(password|passcode|api key|secret key|access token|token|login code|verification code)\b", re.I)
PAY_RE = re.compile(r"\b(stripe|paypal|venmo|cash\s?app|zelle|square checkout|apple cash)\b", re.I)
# Asked to post, publish or send something himself (2026-11-17: he wrote the post and did not say it was only a draft).
PUBLISH_NOW_RE = re.compile(r"\b(post|publish|send|upload|schedule|push|go live)\b[^.?!\n]{0,60}\b(right now|now|immediately|today|tonight|for me)\b|"
                            r"\b(post|publish|upload|send) (this|it|that|these)\b[^.?!\n]{0,40}\bto\b", re.I)
DRAFT_ONLY_RE = re.compile(r"\b(draft|approv\w*|cannot|can(?:no|')t|not able|only draft|your ok|aaron'?s ok)\b", re.I)
# Asked to look at Aaron's own mail or calendar: Steve has no access; that is the personal agent's job.
PERSONAL_ASK_RE = re.compile(r"\b(check|read|search|open|scan|look (?:in|at|through)|go through|what(?:'s| is) (?:in|on)|anything (?:in|on))\b"
                             r"[^.?!\n]{0,30}\b(?:my|aaron'?s|the)? ?(gmail|e-?mails?|inbox|calendar|texts|text messages)\b", re.I)
PERSONAL_REPLY = ("I have no access to your mail or calendar, and I never ask for it. That is Alice's job: ask her on her page. "
                  "I can help with anything for Elevated Designs or Charleston3D.")
WORK_LABEL_RE = re.compile(r"\((?:draft|test|v\d+|polish|wip)\)|\b(?:draft|test|wip)\s*[:\-]\s", re.I)

URL_RE = re.compile(r"https?://[^\s)\]>\"'<]+|\b(?:[a-z0-9-]+\.)*(?:charleston3d\.com|elevatedshirts\.com|epix3d\.com)(?:/[^\s)\]>\"'<]*)?", re.I)
OUR_HOSTS = ("charleston3d.com", "app.charleston3d.com", "elevatedshirts.com", "design.elevatedshirts.com", "epix3d.com")
# Claims nobody gave Steve: delivery times, discounts, guarantees, reviews, awards, scarcity.
CLAIM_RE = re.compile(r"ships?\s+(?:in|within)\s+\d|\b\d+\s*(?:-|to)\s*\d+\s*(?:business\s+)?days\b|\bfree shipping\b|"
                      r"\b\d+\s?% off\b|money[- ]back|\bguarante|\bbest[- ]sell|\baward[- ]winning\b|\b[1-5](?:\.\d)?[- ]stars?\b|"
                      r"\bfive[- ]star\b|\bcustomers (?:love|say|rave)|\bonly \d+ left\b|\blifetime warranty\b", re.I)

# Working notes that must never reach customer text: the rule numbers and how mockups are made.
INTERNAL_RE = re.compile(r"multiply or displacement|ghost mannequin|no AI (?:drawings|images|renders)|\brule \d+\b|\bship-check\b|price sheet", re.I)

# A tool call written out as text instead of an answer (small models do this now and then).
TOOLCALL_RE = re.compile(r"^\s*(?:<tool_call>|[a-z_]+\([^)]{0,200}\)\s*$)|\b(?:skill_view|tool_search|read_file|search_files)\(", re.I)

AD_CAP = 2.00
# Amounts that are rules, not product prices: the ad cap.
ALWAYS_ALLOWED = {2.0}


def strip_emoji(text):
    """Rule 17: no emoji. Removed, never a reason to reject."""
    return EMOJI_RE.sub("", text or "").strip()


def money(text):
    return [float(m.replace(",", "")) for m in PRICE_RE.findall(text or "")]


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text or "") if s.strip()]


def brands(text):
    return {b for b, rx in (("c3d", C3D_RE), ("ed", ED_RE)) if rx.search(text or "")}


def clean_url(u):
    u = re.sub(r"^https?://", "", u.strip().lower()).split("?")[0].split("#")[0]
    return re.sub(r"^www\.", "", u).rstrip("/.,;:!")


def bad_links(reply, asked, known_urls):
    """Links Steve could not have: a product page that is not on the live store, or any outside site Aaron did not give."""
    given = {clean_url(u) for u in URL_RE.findall(asked or "")}
    known = {clean_url(u) for u in known_urls or ()}
    out = []
    for raw in URL_RE.findall(reply or ""):
        u = clean_url(raw)
        if not u or u in given or u in known or u in out:
            continue
        host, _, path = u.partition("/")
        if host in OUR_HOSTS:
            if not path:
                continue                      # a store or app home page
            if known and "products/" in path:
                out.append(u)                 # a product page the store does not have
            elif not path.startswith(("collections", "pages", "products")):
                out.append(u)
        else:
            out.append(u)
    return out


def check(reply, asked="", allowed_prices=(), known_urls=None):
    """Every rule the reply breaks, as plain sentences the model (and Aaron) can act on. Empty list = passed.
    known_urls: the real product pages (prices.product_urls()); when given, made-up links are caught."""
    bad = []
    reply = reply or ""
    asked = asked or ""
    said, wanted = brands(reply), brands(asked)

    if TOOLCALL_RE.search(reply) or not reply.strip():
        return ["That was a tool call or an empty answer, not an answer. Use the tool, then write the full answer in words."]

    # Rule 3: one brand per piece of content.
    if DRAFT_RE.search(asked):
        if len(wanted) == 1 and said - wanted:
            bad.append("Rule 3: this was asked for one brand, so do not name the other brand anywhere in it.")
        elif len(said) == 2 and not REFUSAL_RE.search(reply):
            bad.append("Rule 3: one piece of content covers ONE brand. Write it for the first brand only and "
                       "offer a separate piece for the other.")

    # Rule 10: only prices from the live store (or ones Aaron typed himself).
    ok = {round(p, 2) for p in allowed_prices} | {round(p, 2) for p in money(asked)} | ALWAYS_ALLOWED
    invented = sorted({p for p in money(reply) if round(p, 2) not in ok})
    if invented:
        bad.append("Rule 10: these prices are not on the live store's price list: "
                   + ", ".join(f"${p:,.2f}" for p in invented) + ". Use only listed prices, or say the price is not listed.")

    # Rule 16: never suggest more than $2.00 a day on ads.
    over = sorted({p for p in (float(m.replace(",", "")) for m in PER_DAY_RE.findall(reply)) if p > AD_CAP})
    if over and re.search(r"\b(ad|ads|advert|boost|campaign|budget|spend|meta|facebook|instagram)\b", reply, re.I):
        bad.append("Rule 16: ad spend is capped at $2.00 a day in total across both brands. Do not suggest more.")

    # Rule 11: the city only.
    if PHONE_RE.search(reply):
        bad.append("Rule 11: no phone numbers. Show only the city, Charleston, SC.")
    if STREET_RE.search(reply):
        bad.append("Rule 11: no street addresses. Show only the city, Charleston, SC.")

    # Rules 2 and 4: never recommend Netlify or another payment service.
    for s in sentences(reply):
        if re.search(r"netlify", s, re.I) and not NEGATION_RE.search(s) and not re.search(r"netlify", asked, re.I):
            bad.append("Rule 2: never Netlify. Stores run on Shopify, apps on GitHub Pages, the console on Cloudflare.")
            break
    if PAY_RE.search(asked) and not re.search(r"shopify", reply, re.I):
        bad.append("Rule 4: he asked about another payment service. Say no: all payments go through Shopify checkout, "
                   "and write the line that way.")
    for s in sentences(reply):
        if PAY_RE.search(s) and not NEGATION_RE.search(s):
            bad.append("Rule 4: all payments go through Shopify checkout. Do not suggest another payment service.")
            break

    # Rule 17: nothing unfinished in what Aaron or a customer reads.
    m = PLACEHOLDER_RE.search(reply)
    if m:
        bad.append(f'Rule 17: "{m.group(0)[:60]}" is a placeholder. Use the real link or fact, or leave it out and '
                   "say in one line what Aaron needs to add.")
    m = INTERNAL_RE.search(reply) if DRAFT_RE.search(asked) and not REFUSAL_RE.search(reply) else None
    if m:
        bad.append(f'Rule 17: "{m.group(0)}" is a working note, not something a customer should read. Take it out of the text.')
    if DRAFT_RE.search(asked) and WORK_LABEL_RE.search(reply):
        bad.append('Rule 12: no work labels such as "draft" or "test" inside text customers will see.')

    # Rule 1: nothing fake. No made-up links and no claims nobody gave him.
    if known_urls is not None:
        links = bad_links(reply, asked, known_urls)
        if links:
            bad.append("Rule 1: these links are not real pages on the store: " + ", ".join(links[:3])
                       + ". Use a link from the price list, the store's home page, or no link.")
    m = CLAIM_RE.search(reply)
    if m and m.group(0).lower() not in asked.lower() and not NEGATION_RE.search(
            next((s for s in sentences(reply) if m.group(0) in s), "")):
        bad.append(f'Rule 1: "{m.group(0)}" is a claim nobody gave you (delivery time, discount, guarantee, review or '
                   "award). Leave it out unless Aaron stated it.")

    # Rule 9: Steve drafts; he cannot publish, send or change anything.
    m = DONE_RE.search(reply)
    if m:
        bad.append(f'Rule 9: you cannot have "{m.group(1)}" anything; you only draft. Say it is a draft for Aaron to approve.')

    if PUBLISH_NOW_RE.search(asked) and not LEAK_ASK_RE.search(asked) and not DRAFT_ONLY_RE.search(reply):
        bad.append("Rule 9: he asked you to post, publish or send it. You cannot. Say so in one sentence, give the text "
                   "as a draft, and end by saying it is ready for Aaron to approve.")

    # Rule 21: on Aaron's team. His and his customers' information never leaves his systems.
    if LEAK_ASK_RE.search(asked) and not LEAK_NO_RE.search(reply):
        bad.append("Rule 21: you are on Aaron's team. Never sell, share, send or post his information or a customer's. "
                   "Say no, and say it stays inside his systems.")
    if DRAFT_RE.search(asked):
        strangers = sorted({e for e in EMAIL_RE.findall(reply) if not OWN_EMAIL_RE.match(e) and e.lower() not in asked.lower()})
        if strangers:
            bad.append("Rule 21: never put someone's email address in text other people will read. "
                       "Only the store's own hello@ address may appear.")

    # Rule 8: never ask for a secret.
    if SECRET_ASK_RE.search(reply) and not NEGATION_RE.search(SECRET_ASK_RE.search(reply).group(0)):
        if not re.search(r"\b(never|do not|don'?t)\b[^.?!\n]{0,60}\b(password|key|token|code)\b", reply, re.I):
            bad.append("Rule 8: never ask for a password, key, token or code.")

    return bad


def blocked_message(problems):
    """What Aaron sees when two tries both broke a rule: the reason, in plain words, and what to do."""
    return ("I could not write that without breaking a rule, so I stopped instead of guessing.\n\n"
            + "\n".join("- " + p for p in problems)
            + "\n\nAsk again with the missing detail, or hand this one to Claude.")
