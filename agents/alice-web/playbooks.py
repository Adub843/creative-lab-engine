"""Aaron's business playbooks, put in front of Alice by code (Aaron, 2026-11-16: "make sure Alice is trained and
ready and her files and rules are built right so she can read them").

A small model does not reliably open the right skill by itself, so this step does it: when a message is about the
business, it picks the matching card (the short skills built from agents/local-skills) and puts it in front of the
question. The same cards are also loaded as Hermes skills, so there is one source for both.

Nothing personal is in a card. Cards are about the business only.
"""
import datetime
import re
from pathlib import Path

DIRS = [Path.home() / ".hermes/skills/aaron", Path(__file__).resolve().parent.parent / "local-skills"]
MAX_CARDS = 2
MAX_CHARS = 7000

# A message is about the business when it names a brand or one of the business's own things...
BIZ_RE = re.compile(
    r"\b(elevated designs?|elevated shirts?|elevatedshirts|charleston ?3d|c3d|epix ?3d|over-?engineered|lowcountry club|"
    r"(?:our|my|the|both|each|either) (?:two )?(?:stores?|shops?|sites?|websites?|brands?|business(?:es)?|company|customers?|products?|"
    r"listings?|ads?|socials?|console|price sheet|agents?)|"
    r"shirt app|order app|custom requests?|price sheet|creative lab|the console|business console|holo\b|kittl|shopify|"
    r"for (?:ed|the store|the shop|the brand)|steve\b|blink\b|gmktec|the nuc\b|zima|dell server)\b", re.I)
# ...or asks about one of Aaron's standing rules by its own words.
RULE_RE = re.compile(
    r"\b(netlify|stripe|ad (?:cap|limit|spend|budget)|spend(?:ing)? (?:cap|limit)|hard rules?|aaron'?s rules?|company rules?|"
    r"photo-?real|design preview|business console|invent (?:a )?prices?|typed ok)\b", re.I)

# The first matching rows win, in this order. Each row: card name, what the message has to mention.
ROUTES = [
    ("company-rules", re.compile(r"\b(rules?|allowed|permitted|are we able|may (?:i|we|you)|can (?:i|we|you) (?:use|put|post|say|show|mix|combine)|"
                                 r"is it ok(?:ay)?|netlify|stripe|ad (?:cap|limit)|spend(?:ing)? (?:cap|limit)|business console|typed ok|"
                                 r"secrets?|passwords?|street address|phone number|same post|both brands)\b", re.I)),
    ("marketing-and-ads", re.compile(r"\b(ads?|advertis\w*|ad spend|budgets?|campaigns?|boost\w*|meta|promotions?|promo|discounts?|coupons?|"
                                     r"marketing|what (?:should|to) (?:we |i )?post next|engagement)\b", re.I)),
    ("c3d-quote-triage", re.compile(r"\b(quotes?|custom requests?|custom (?:print|order)s?|stl|3mf|obj file|step file|print request|"
                                    r"wants? (?:us )?to print|can we print)\b", re.I)),
    ("photo-real-images", re.compile(r"\b(images?|photos?|pictures?|mock-?ups?|renders?|blender|photo-?real|design preview|product shots?)\b", re.I)),
    ("social-post", re.compile(r"\b(posts?|captions?|instagram|facebook|pinterest|tiktok|hashtags?|reels?|stor(?:y|ies)|social)\b", re.I)),
    ("product-listing-copy", re.compile(r"\b(listings?|product (?:title|description|copy|page)s?|descriptions?|titles?|tags|alt text|"
                                        r"prices?|pricing|price sheet|how much (?:is|are|do|does|should))\b", re.I)),
    ("seo-local", re.compile(r"\b(seo|search (?:engine|console|results?|ranking)s?|google|bing|keywords?|rank\w*|ai search|"
                             r"business profile|sitemap|indexnow)\b", re.I)),
    ("ideas-brief", re.compile(r"\b(ideas?|new products?|what (?:else )?(?:could|should) we (?:sell|make|build)|opportunit\w*|brainstorm|brief)\b", re.I)),
    ("daily-ops", re.compile(r"\b(morning brief|daily brief|orders?|deadlines?|renew\w*|taxes|tax|license|backups?|scheduled|jobs?|"
                             r"overnight|what runs)\b", re.I)),
    ("system-map", re.compile(r"\b(where (?:is|are|do|does)|which (?:machine|pc|computer|agent|server)|who (?:handles|does|runs)|blink|nuc|gmktec|"
                              r"dell|zima|steve|console|machines?|servers?|agents?|recovery)\b", re.I)),
    ("ship-check", re.compile(r"\b(check (?:this|it|my|the)|review (?:this|it|my|the)|before (?:it goes|sending|posting)|ship.?check|"
                              r"is (?:this|it) ready|proofread)\b", re.I)),
    ("company-brand-kit", re.compile(r"\b(brand|colou?rs?|logos?|voice|tone|fonts?|hex|contact|email address)\b", re.I)),
]
# Writing for customers always gets the brand kit beside the task card.
WRITES = {"social-post", "product-listing-copy"}


def about_business(message):
    m = message or ""
    return bool(BIZ_RE.search(m) or RULE_RE.search(m))


def pick(message):
    """The cards for this message, most specific first. [] when it is not about the business."""
    m = message or ""
    if not about_business(m):
        return []
    names = [name for name, rx in ROUTES if rx.search(m)][:MAX_CARDS]
    if names and names[0] in WRITES:
        names = [names[0], "company-brand-kit"]
    return names or ["aaron-business"]


def read(name):
    """The card's text without its header block, or "" when it is not installed."""
    for d in DIRS:
        f = d / name / "SKILL.md"
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            continue
        if text.startswith("---"):
            text = text.split("\n---", 1)[-1]
        return text.strip()
    return ""


def prefix_for(message):
    """Text to put in front of Aaron's message: the matching playbook(s), or "" when the message is not about the business."""
    parts, room = [], MAX_CHARS
    for name in pick(message):
        body = read(name)
        if not body or len(body) > room:
            continue
        parts.append("[Aaron's playbook: " + name + "]\n" + body)
        room -= len(body)
    if not parts:
        return ""
    return ("\n\n".join(parts) + "\n[End of playbook. Today's yyyymm is " + datetime.date.today().strftime("%Y%m") + ". "
            "Answer Aaron from the playbook above, in your own short words. "
            "If the playbook forbids what he asks, say no and give the reason in one sentence. "
            "If he asks for one post about both brands, write the post for the first brand only and offer a separate one for the other. "
            "If the playbook says Aaron or Claude decides it (a price, a quote, an ad budget), say who decides and list the facts they need. "
            "If he asks you to write something, write the draft the playbook allows and end with: ready for Aaron to approve. "
            "Only when the playbook says nothing about it, say you do not have that written down. "
            "Never make up a price, a rule, a link, a file name or a status. You only draft: never say you posted, sent or changed anything.]\n\n"
            + directive(message))


_ED_RE = re.compile(r"\b(elevated designs?|elevated shirts?|elevatedshirts|over-?engineered)\b", re.I)
_C3D_RE = re.compile(r"\b(charleston ?3d|c3d)\b", re.I)
_WRITE_RE = re.compile(r"\b(write|draft|make|create|give me|come up with)\b", re.I)
_PRICE_RE = re.compile(r"\b(how much|price|quote (?:him|her|them|for|at)|should i quote|what (?:do|should) (?:i|we) charge|cost)\b", re.I)


def directive(message):
    """One plain instruction for the two cases the small model got wrong on Aaron's test questions (2026-11-16)."""
    m = message or ""
    ed, c3d = _ED_RE.search(m), _C3D_RE.search(m)
    if ed and c3d and _WRITE_RE.search(m):
        first, other = ("Elevated Designs", "Charleston3D") if ed.start() < c3d.start() else ("Charleston3D", "Elevated Designs")
        return ("[He named both brands. One piece covers one brand. Write the piece now for " + first + " ONLY, with no mention of "
                + other + " in it. After the piece, add one line offering a separate one for " + other + ".]\n\n")
    if "c3d-quote-triage" in pick(m) and _PRICE_RE.search(m):
        return ("[He asked what to charge. You never state a price: say Aaron prices every quote, then list what Aaron needs to price it "
                "(size, quantity, colors, deadline, the file). If the request uses a logo, team name or character we do not own, say first "
                "that we cannot print it and that we can offer an original design.]\n\n")
    return ""


_FAKE_FILE_RE = re.compile(r"^\s*[\[(]\s*(?:image|photo|picture|img)\b[^\n]*[\])]\s*$", re.I | re.M)
_TAG_RE = re.compile(r"(?<!\w)#[A-Za-z0-9_]+")
_LINK_TO_RE = re.compile(r"\[\s*link to\s+(?:https?://)?([a-z0-9.-]+\.[a-z]{2,}[^\]\s]*)\s*\]\s*(?=\?)?", re.I)
_EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]+ ?")


_OUR_LINK_RE = re.compile(r"https?://(?:www\.)?(charleston3d\.com|elevatedshirts\.com)(/[^\s?#)\]]*)?", re.I)


def tidy(reply, asked=""):
    """Fixes a small model keeps needing in a draft: an invented image line, a made-up page on one of the stores,
    emoji, and more than 8 hashtags. `asked` is Aaron's message: a store link he gave himself is left alone."""
    out = _FAKE_FILE_RE.sub("", reply or "")
    out = _LINK_TO_RE.sub(lambda m: "https://" + m.group(1), out)      # "[Link to charleston3d.com] ?utm..." -> a real link

    def real_page(m):                                                   # she is never given product pages, so a path is a guess
        path = m.group(2) or ""
        return m.group(0) if (not path.strip("/") or path in (asked or "")) else "https://" + m.group(1).lower()
    out = _OUR_LINK_RE.sub(real_page, out)
    out = _EMOJI_RE.sub("", out)                                        # rule 17: no emoji in anything for customers
    if len(_TAG_RE.findall(out)) > 8:
        seen = [0]

        def keep(m):
            seen[0] += 1
            return m.group(0) if seen[0] <= 8 else ""
        out = _TAG_RE.sub(keep, out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


if __name__ == "__main__":
    import sys
    q = " ".join(sys.argv[1:])
    print(pick(q))
    print(prefix_for(q)[:600])
