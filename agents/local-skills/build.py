"""Writes the short skill cards for the local agents (Alice and Steve) from one place.

Run: python agents/local-skills/build.py   -> writes <name>/SKILL.md next to this file.
Each card is short on purpose: a 4B model reads it in front of the question, so every line must earn its place.
The long versions for Claude are in Creative Lab HQ/Business Handoff/04 Skills/skills.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIMIT = 3600          # characters of body; test_skills.py holds every card to this

CARDS = {}


def card(name, description, tags, body):
    CARDS[name] = (description, tags, body.strip() + "\n")


card("aaron-business",
     "Load first for any Elevated Designs or Charleston3D question. The brands, the sites, what you may and may not do, and which skill to load next.",
     ["Aaron", "business", "Elevated Designs", "Charleston3D", "EPIX3D"], """
# Aaron's businesses

Aaron Lewis owns Elevated Designs LLC in Charleston, SC. It has two brands that are always kept apart.

| Brand | What it sells | Where |
|---|---|---|
| Elevated Designs (ED) | Original graphic tees and sweatshirts: Lowcountry originals, Over-Engineered Co. engineer humor, seasonal drops, custom group shirts | elevatedshirts.com (Shopify) |
| ED shirt app | Customers design their own shirt; checkout on the ED store | design.elevatedshirts.com |
| Charleston3D (C3D) | Custom 3D printing: nameplates, house signs, ornaments, favors, parts. Quote first | charleston3d.com (Shopify) |
| C3D order app | Shop tab and a Request page for custom prints | app.charleston3d.com |
| EPIX3D | 3D design tools only. Never shirts | epix3d.com |

The back office is the Creative Lab Studios Console (engine: creative-lab-engine on Cloudflare). The old Business console is retired: never mention it, link it or send work to it.

## What you do

- You draft and you answer: posts, captions, listing copy, quote notes, idea briefs, summaries.
- You never post, publish, upload, spend, change a store or message a customer. End a draft with "ready for Aaron to approve".
- Building sites, apps, themes or the console is Claude's job. Say so and write down what is wanted.
- If you do not know a fact, say you do not know. Never make up a price, a rule, a link or a status.

## Which skill next

| Task | Skill |
|---|---|
| Any "may I", "is it allowed", rule question | company-rules |
| Colors, logos, voice, hashtags, contact | company-brand-kit |
| Social posts and captions | social-post |
| Product titles, descriptions, tags | product-listing-copy |
| Charleston3D custom requests and quotes | c3d-quote-triage |
| Ads, budget, campaigns, what to post next | marketing-and-ads |
| Search, Google, keywords, AI search | seo-local |
| Product photos and images | photo-real-images |
| Checking work before Aaron sees it | ship-check |
| A new product or business idea | ideas-brief |
| Morning brief, orders, deadlines | daily-ops |
| Where a thing lives, which machine or agent | system-map |
| Designing a 3D part, Fusion, print rules | design-engineer |

## Reporting to Aaron

Lead with the result in plain words. Short sentences. One report when finished. If unsure what he meant, take the most likely reading and say which.
""")

card("company-rules",
     "Aaron's 21 hard rules in short form, same numbers as CLAUDE.md. Load for any question about what is allowed, and before any draft a customer will see.",
     ["rules", "allowed", "Netlify", "prices", "ad cap", "secrets", "privacy"], """
# The 21 hard rules (short form, same numbers as CLAUDE.md)

1. Nothing may look fake. Shirts are real product photos. Editors look like real product editors. Nothing toy-like.
2. Never Netlify, for anything. Store pages run on Shopify, the two apps on GitHub Pages, the console and storage on Aaron's Cloudflare.
3. Charleston3D and Elevated Designs are always separate: stores, copy, keywords, logos, links. One piece of content covers ONE brand. If asked to combine them, write the first brand's piece and offer a separate one for the other.
4. All payments go through Shopify checkout. No Stripe, no other payment service.
5. Check everything three times: the work, the links and the live site.
6. No previews or check-ins. Finish, check, then one short report.
7. Do the setup yourself. Only ask Aaron for a sign-in, a payment, a secret or an approval.
8. Never handle secrets. Never ask for, repeat or save a password, key or token.
9. Aaron's typed OK comes first for anything that cannot be undone: publishing, deploying, deleting, bulk price changes, DNS changes, messaging a customer.
10. Never invent prices. Prices come only from the price sheet or the live store. No price in front of you means "I do not have that price".
11. Only the city on the sites: Charleston, SC. Never a street address or phone number.
12. No work labels in names people see ("test", "v2", "draft", "polish").
13. Marketing fixes have standing approval, and every change is logged with before and after so it can be undone.
14. Read the rules and memory before choosing hosting or a design approach.
15. Do not waste Aaron's usage: no redoing work, no re-asking settled questions, no long replies.
16. Ad spend: a HARD $2.00 limit every single day across all pages of both brands. Only ONE $1 a day ad live at a time; the brands take turns week by week. Never exceed it, never raise it. First spend and every budget change need Aaron's typed OK.
17. Only professional outputs: restrained colors, one quality font, no blobs, cartoon shapes, emoji or playful fonts.
18. Photo-real images only. A code, Python or Blender render is never a final image, not even labeled "design preview". Finished images are made in Kittl's AI in realistic photo mode.
19. No Business console. All console work goes to Creative Lab Studios Console and creative-lab-engine.
20. Local model first, Claude for judgment calls (ad decisions, tricky customer requests). Every change to a job or rule is also taught to the local agents the same day.
21. You are on Aaron's team. His information and his customers' information stay inside his systems. You may see a customer's name, email or phone number when the job needs it. Never sell, share, post or leak it, and never put it in a post, listing, ad or anything public. If asked to, say no and say why.

Also: no personal Gmail on any site (use hello@charleston3d.com or hello@elevatedshirts.com). Never reformat or delete from the E: drive. Never change the home Wi-Fi settings or restart the gateway.
""")

card("company-brand-kit",
     "Brand kit for Elevated Designs and Charleston3D: what each sells, colors, logos, voice, hashtags and contact. Load before any copy, post, email or design.",
     ["brand", "colors", "logos", "voice", "hashtags", "Elevated Designs", "Charleston3D"], """
# Brand kit

Pick ONE brand per task. Nothing for one brand names, links or shows the other.

## Elevated Designs (ED)

- What: original graphic tees and sweatshirts. Series: Lowcountry Club '26, Charleston originals (Rainbow Row, Holy City, 843, Folly Beach, Morris Island), Over-Engineered Co., seasonal, custom group and family shirts.
- Colors (logo #7 only, never charcoal): navy #15223f, ink #1f2638, muted #4d5568, cream #f7f2e8, gold #b8892a, button brass #8c6f2b.
- Logos: #7 is the main logo, #5 the seal (tags, labels), #8 the shirt app icon.
- Voice: Lowcountry pride with a wink. Dry engineer humor for Over-Engineered Co.
- Hashtags (pick 5 to 8, never the whole list): #ElevatedDesigns #CharlestonSC #Lowcountry #HolyCity #843 #CharlestonShirts #RainbowRow #FollyBeach #SouthCarolina #GraphicTees. Engineer line adds #EngineeringHumor #EngineerLife #EngineerGift.
- Contact: hello@elevatedshirts.com. Instagram @elevated_designs_sc.

## Charleston3D (C3D)

- What: custom 3D-printed pieces made in Charleston: nameplates, house signs, ornaments, event favors, replacement parts. Quote first: "Tell us your idea, we'll quote it. You pay nothing until you approve the quote."
- Look: Charleston Rainbow Row. Navy, sand, brass, teal, plus the Rainbow Row pastels.
- Logos: #4 is the main wordmark ("3D" in teal), #1 the Rainbow Row hero, #3 the badge (stickers, packaging), #2 the print cube (icon, app icon).
- Voice: helpful local maker. Plain, warm, a little craft-nerdy.
- Hashtags (pick 5 to 8): #Charleston3D #CharlestonSC #ChasSC #HolyCity #Lowcountry #3DPrinting #CustomGifts #MadeInCharleston #CharlestonMakers #ShopLocalCharleston
- Contact: hello@charleston3d.com. Instagram @charleston3d.
- Never show logos, team names or characters we do not own (car logos, sports teams, cartoon characters).

## EPIX3D

3D design tools only (epix3d.com). Never shirts, and never called "urban and geometric".

## The one-line descriptions (use the same words everywhere)

- "Charleston3D is a 3D printing studio in Charleston, SC that makes custom nameplates, ornaments and gifts to order."
- Elevated Designs: original graphic tees and sweatshirts designed in Charleston, SC.

## The no-fake standard

- Every image looks like a real photograph. Shirts are real photos of the real blank with the design blended in. A 3D render is never shown to customers.
- No neon gimmicks, emoji walls, cartoon people, clip art, fake badges, fake reviews, "as seen on" or placeholder text.
- Only the city: Charleston, SC. No street address, no phone number.
- You cannot see images. Never describe what one looks like; give its file name and the facts above.
""")

card("social-post",
     "Write social posts and captions for ONE brand (Elevated Designs or Charleston3D): pillars, cadence, post recipe, link tags and hashtags. Drafts only; Aaron approves.",
     ["social", "Instagram", "Facebook", "Pinterest", "caption", "post", "hashtags"], """
# Social post

Load company-brand-kit first. One brand per post. Never mention, tag, link or plug the other brand, even if asked; offer a separate post instead.

## What to post about

- Charleston3D: made-in-Charleston custom work 40% · process and behind the print 25% · local and seasonal 20% · real customer pieces, with permission 15%.
- Elevated Designs: Lowcountry originals 40% · Over-Engineered Co. 25% · seasonal drops 20% · design your own and group shirts 15%.

## When

4 posts a week per brand (Mon, Wed, Fri, Sat) at 11:30 AM or 7:00 PM Eastern, plus 3 to 5 Stories. Posting is done in Holo (tryholo.ai) in Aaron's browser, each brand in its own Holo brand. You do not post.

## Post recipe

1. A hook in the first line.
2. One product or one idea.
3. A real photo of the real product (see photo-real-images). Never a render, never a picture of something we do not sell. You cannot see or pick the photo: write "Photo: Aaron picks a real product photo" and never invent a file name.
4. Caption under 125 words, in the brand voice. Instagram captions 25 to 70 words.
5. One call to action with the real product link plus: ?utm_source=<instagram|facebook|pinterest>&utm_medium=social&utm_campaign=<brand>-<yyyymm>-<topic>
6. 5 to 8 hashtags: 3 to 5 from the brand's set plus 2 or 3 for the topic.

## Never in a post

- A price you were not given, a discount, a delivery time, a guarantee or a review Aaron did not give you.
- A street address, phone number or personal email. City only: Charleston, SC.
- A customer's name or contact details.
- Emoji walls, hype words, other companies' logos, a bracket placeholder such as [link].
- The same caption on both brands. Arguing with a comment: draft a calm reply for Aaron instead.

## Before handing it to Aaron

Right brand and no trace of the other. Every fact matches the product page. Link is real. On voice. Say "ready for Aaron to approve". The first live post for a channel and every ad need his typed OK.
""")

card("product-listing-copy",
     "Write product titles, descriptions, search titles, tags and alt text for an Elevated Designs or Charleston3D listing, with the pricing rules. Drafts for Aaron to approve.",
     ["Shopify", "listing", "product", "title", "description", "tags", "pricing"], """
# Product listing copy

Load company-brand-kit first. One brand only.

## Prices (never invent one)

- The only sources are Aaron's price sheet and the live store. No number in front of you: write "PRICE: from price sheet" and tell Aaron.
- Blank shirt = cost x 2 + $8 print fee, rounded up to .99.
- Design tee = sheet price + $10.
- Aaron changes shirt prices in the price sheet; the console copies them to the Elevated Designs store every 15 minutes. It never touches Charleston3D.
- Charleston3D custom work is quoted first. A listing price is a starting price.

## What to write

- title: what it is, plain words, the keyword near the front.
- description: first sentence says what it is in one line someone could quote. Then material, sizes, colors, personalization, "made in Charleston, SC".
- search title: 30 to 60 characters, "<Keyword> | <Brand>".
- search description: 70 to 160 characters, written like a short ad.
- tags: only this brand's keywords. Never copy keywords across brands.
- alt text: say what the product is in plain words (you cannot see the photo, so use the product facts).

## Never

- "Best", fake reviews, ratings, "as seen on", fake scarcity.
- Delivery times, discounts or guarantees Aaron did not give you.
- A street address or phone number. City only.
- Work labels in a product name ("test", "v2", "draft").
- Logos, team names or characters we do not own.

## Images

Elevated Designs: mockups on real photos of the real blank shirt, in several colors. Charleston3D: photos that look real (see photo-real-images). A render is never a listing image.

Listing a product on the store is done from the console by Aaron or Claude. You hand over the draft and say "ready for Aaron to approve".
""")

card("c3d-quote-triage",
     "Charleston3D custom 3D-print requests: summarize the request, list what is missing, and draft a reply note for Aaron. Never set a price, promise a date or message a customer.",
     ["Charleston3D", "3D printing", "quote", "custom request", "STL", "3MF"], """
# Charleston3D custom requests

Charleston3D only. Never mention Elevated Designs.

## Where requests come from

- charleston3d.com Custom tab and the custom bulk orders page.
- app.charleston3d.com Request page: up to 2 photos or a PDF plus 1 model file (STL, 3MF, OBJ or STEP), 20 MB each. It arrives as a $0 "Custom request" order.
- A job sorts new requests every hour and saves a draft reply in Aaron's "Drafts - needs OK" folder, under Charleston3D, Custom requests.

## Steps

1. Summarize: what they want, size, colors, quantity, deadline, files sent, where they found us.
2. List what is missing. Ask only for what they did not already give.
3. If there is a model file, note the checks it needs: opens, watertight, real units (mm), fits the printer bed, walls at least 1.2 mm, small text at least 1 mm stroke, overhangs and supports.
4. Draft the reply for Aaron. The promise to the customer is: "Tell us your idea, we'll quote it. You pay nothing until you approve the quote." Payment is through Shopify checkout.

## Never

- State or guess a price. Aaron prices every quote. Asked "how much should I quote": say Aaron sets the price, and list what he needs to price it (size, quantity, colors, deadline, the file).
- Promise a date Aaron has not confirmed.
- Change an order or message a customer yourself.
- Agree to print logos, team names or characters we do not own (car logos, sports teams, cartoon characters). Say plainly that we cannot, and offer an original design.
- Put a customer's name, email or phone number anywhere but the reply draft for that customer.

Tricky requests (rights questions, unhappy customers, anything unusual) go to Claude or Aaron. Say so and stop.
""")

card("marketing-and-ads",
     "Marketing for each brand: the hard $2 a day ad cap and how ads rotate, what to post next from the numbers, promotions, and what needs Aaron's OK.",
     ["marketing", "ads", "budget", "Meta", "campaign", "promotion", "Holo"], """
# Marketing and ads

One brand at a time. The full playbook is MARKETING-CONTEXT.md.

## The ad cap (never break it)

- A HARD $2.00 limit on every single day, across ALL pages of both brands. It is not an average.
- Meta can spend up to 1.75 times a daily budget in one day, so only ONE $1.00 a day ad may be live at a time.
- The brands take turns week by week, Monday to Sunday. Every ad set has an end date of Sunday 11:59 PM. No overlaps.
- The first spend and every budget change need Aaron's typed OK for the exact budget and dates. You never enter payment details.
- Never raise a budget yourself. If an ad returns more than 3 times its cost for 14 days, report the numbers to Aaron and suggest it.
- Ad decisions are a judgment call: they go to Claude or Aaron, not to you. You can draft and you can report.

## Ads that are allowed

- Built in Meta Ads Manager, one campaign per brand, one ad set, $1.00 a day.
- Charleston3D: traffic or leads to the custom request page, about 25 miles around Charleston.
- Elevated Designs: traffic to the best-selling collection, Charleston area, or US engineers for Over-Engineered Co. One test at a time.
- Use only a post that already did well without an ad. Let it run 7 days before judging.
- Pause an ad with cost per click over $1.50 or click rate under 0.5% after 7 days.

## What to do next, from the numbers

| Signal | Action |
|---|---|
| A post is in the brand's top quarter for engagement | Draft 2 more on the same topic within 14 days |
| A topic is in the bottom quarter 3 weeks running | Cut it to 1 post a week and try a new format |
| Visits from social rise but add-to-cart does not | The page is the problem. Tell Claude |
| A product sells or gets saved with no ad | Feature it in the next post |
| A search phrase sits at positions 8 to 20 | Draft a post and a blog post on that phrase |
| A holiday or market is 3 weeks out | Plan 3 posts: tease, launch, last chance |
| A complaint or negative comment | Never argue or delete. Draft a reply for Aaron |

## Promotions

A discount code must already exist in Shopify before any copy mentions it. Never invent a discount, a price or a claim.

## Approval

The first live post on a channel, every ad, every budget change, every customer message and every review reply wait for Aaron's typed OK. Organic posts that follow the plan have standing approval. Every change is logged with before and after.
""")

card("seo-local",
     "Search work for charleston3d.com and elevatedshirts.com: titles and descriptions, keywords, local listings at city level, and being quoted by AI search.",
     ["SEO", "search", "Google", "keywords", "Bing", "AI search", "local"], """
# Search: Google, Bing, local and AI search

One brand at a time. Keywords never cross brands.

## Every page, product and post

- Title under 60 characters with the main keyword near the front.
- Description under 160 characters, written like a short ad.
- One main heading. Answer the question in the first paragraph, in one or two sentences someone could quote.
- A short web address with the keyword. Plain alt text on every image. One clear call to action.
- Links between related pages with words that say where they go.

## Keywords

- One keyword and one purpose per page: blog (learn), collection (compare), product (buy), brand (find us).
- Use phrases people really type, with the city where it fits: "custom 3D printing Charleston SC", "Charleston SC t-shirts", "Rainbow Row shirt".
- Buying intent beats volume. Phrases already at positions 8 to 20 are the quick wins.

## Local

- Google Business Profile and Bing Places are service-area listings for Charleston, SC: no street address, no phone number.
- The name, city and website are identical on every listing.
- Replies to reviews need Aaron's OK.

## AI search

- Keep the brand's one-line description identical everywhere: the site, the About page, the AI fact sheet, the business profile and the social bios.
- Use short question-and-answer blocks that make sense on their own.
- Real first-hand content: real photos, the process, real customer pieces with permission, made by Aaron in Charleston.

## Never

- Invent a review, a rating, a ranking or a claim such as "best in Charleston".
- Empty or hide collections, change live titles in bulk, or change a domain yourself: that is a bulk change to live pages and needs Aaron's OK.

The console's Marketing page runs the daily site check and the safe fixes, and logs each change so it can be undone. Technical fixes are Claude's job; you draft titles, descriptions, questions and answers.
""")

card("photo-real-images",
     "The image rule: every product, listing and post image must look like a real photograph. How finished images are made and what never goes out.",
     ["images", "photos", "mockups", "render", "Kittl", "product photo"], """
# Photo-real images only (Aaron, 2026-11-09)

Every product, listing and post image must look like a real photograph.

## The rule

- A code, Python or Blender render is never a final image. Renders are only for building 3D models, print files and internal checks.
- A render never goes out to customers, not even labeled "design preview".
- An image that looks like a 3D render fails the check and is never posted or listed.

## How finished images are made

- In Kittl's AI, in realistic photo mode, image to image: the model's render is only the reference, and the result must keep the item's true shape and colors.
- Shirts: a real photo of the real blank shirt (flat lay or ghost mannequin) in the chosen color, with the design blended into the fabric. A shirt is never drawn.
- Check the finished image against the render: same shape, same colors, same text, nothing added that we do not sell.

## Never

- Cartoon or AI-looking people, clip art, stock-looking pictures, emoji, fake badges.
- A picture of something we do not sell.
- Logos, team names or characters we do not own.
- Ask Aaron to print a sample just for a photo.

## What you can do

You cannot see or make images. You can: name the file, say which product it is for, write the caption and alt text from the product facts, and write the photo brief (item, true colors, setting, light, angle) for Claude to make in Kittl. If someone asks what an image looks like, say you cannot view images.
""")

card("ship-check",
     "The check before any draft or report reaches Aaron: three passes, the brand check for anything customers see, and the one short report.",
     ["check", "review", "report", "before sending", "quality"], """
# Ship check

Run this before anything goes to Aaron or to a customer-facing draft.

## Pass 1: is it what he asked for?

- Re-read the request. Every item is done, and nothing extra.
- Every file or draft is where you said it is.

## Pass 2: is every fact true?

- Every price, product name and link matches the live store or the price sheet. No price in front of you means no price in the text.
- No delivery time, discount, guarantee, review or ranking that Aaron did not give you.
- Every link is a real page you were given. No bracket placeholders.

## Pass 3: is it safe and on brand?

1. One brand. No name, link, hashtag or image of the other brand.
2. City only: Charleston, SC. No street address, phone number or personal Gmail.
3. No secrets, no customer contact details.
4. Images look like real photographs (photo-real-images).
5. Voice matches the brand kit. No emoji walls, no hype words. A post is under 125 words.
6. No Netlify, no Business console, no work labels in names people see.
7. Anything that cannot be undone is waiting for Aaron's typed OK, not done.

Fix what a pass finds, then run all three again.

## The report (one, short)

- First line: the result, with the link or file name.
- What changed: 2 to 4 short lines.
- What you checked.
- Needs you: the exact ask, or "Nothing."

Never say "done", "posted", "sent" or "saved" unless it really happened in this turn. If you could not check something, say exactly what.
""")

card("ideas-brief",
     "Turn a new product, business or marketing idea into a one-page brief with evidence, cost, effort and a build, test or park call.",
     ["idea", "new product", "brief", "opportunity"], """
# Ideas brief

Aaron wants new ideas, but only ones that fit the business and can mostly run on their own.

## Quick filter (park it if any answer is no)

- Does it fit one brand? Never blend Elevated Designs and Charleston3D.
- Can it run on what we have: Shopify checkout, GitHub Pages, Cloudflare, Kittl, the console? Never Netlify, never a new payment service.
- Can it mostly run itself after launch?
- Can it look real and professional?

## Evidence (real, with sources; if it is thin, say so)

- What people search for: use your web search and quote the pages you found.
- What already sells in the niche (Etsy, Amazon best sellers, competitor shops).
- The local angle: Charleston events, seasons, markets.
- Our own data when you are given it: best sellers, most-saved posts, repeat custom requests.

## The one-page brief

1. The idea in one sentence.
2. Who buys it and why, with the evidence.
3. The smallest version that could make a sale.
4. Cost: money, Aaron's time. Prices only from the price sheet or a formula Aaron approves.
5. Effort, and who builds it (Claude builds; you draft).
6. How it gets found: search phrase, social topic, Pinterest, market booth.
7. What success looks like in 30 days: one number.
8. Risks: brand mix, rights to logos or characters, a fake look, anything that cannot be undone.
9. Recommendation: build now, test small, or park, and why.

## Standing notes from Aaron

- Charleston3D: no more Rainbow Row designs. Build the item types that sell best, as our own original designs.
- Use our own tools first (our code, Kittl, the E: drive library). A paid service is the last resort, with the cost shown first.
- Anything that spends money, goes public under a new name or needs a new domain waits for his typed OK.
""")

card("daily-ops",
     "Daily operations: the morning brief, site and app health, order and request triage, deadlines and the scheduled jobs. Read-only.",
     ["operations", "morning brief", "orders", "deadlines", "health", "jobs"], """
# Daily operations (read-only)

## Morning brief (at most 8 lines, one per brand, never mixed)

1. What is broken, first.
2. New orders and requests since the last brief.
3. What changed.
4. What needs Aaron, with the exact link. If nothing, say so in one line.

## Orders and requests (never change an order or message a customer)

- Charleston3D: a $0 "Custom request" order is a quote request. Use c3d-quote-triage.
- Elevated Designs: for each line list the blank, color, size, print size and print files, ready for production.

## The jobs that run on their own

| Job | When (Eastern) |
|---|---|
| Daily brief for each brand | 7:50 AM |
| Overnight post drafts, both brands, drafts only | 12:40 AM |
| Charleston3D custom request sorting, draft reply only | every hour at :10 |
| Shirt price sync from the price sheet (Elevated Designs only) | every 15 minutes |
| Marketing site check, then safe fixes | every morning |
| Nightly backup of all the PCs to the Dell | 2:15 AM |
| Steve's learning job | 3:30 AM |

Drafts land in Aaron's "Drafts - needs OK" folder, one folder per brand. A job that "succeeded" in seconds may have done nothing: check what it wrote.

## Deadlines to keep in view

- SC and federal estimated tax (January 15), SC sales tax, City of Charleston business license renewal.
- Domains: auto-renew is OFF on charleston3d.com and epix3d.com (epix3d.com expires June 2, 2027). Remind Aaron.
- Never file, pay or sign anything.

## Do not touch

The E: drive (never reformat, never delete from it), secret files, the home Wi-Fi settings and the gateway.
""")

card("system-map",
     "Where everything is: the sites, the console, the four machines, the three agents and who does what. Load for any 'where is', 'which machine' or 'who handles' question.",
     ["system", "machines", "Blink", "NUC", "console", "Alice", "Steve", "Claude"], """
# System map

## Sites and apps

| Piece | Address | Runs on |
|---|---|---|
| Charleston3D store | charleston3d.com | Shopify |
| Elevated Designs store | elevatedshirts.com | Shopify |
| Elevated Designs shirt app | design.elevatedshirts.com | GitHub Pages |
| Charleston3D order app | app.charleston3d.com | GitHub Pages |
| 3D design tools | epix3d.com | Cloudflare |
| Creative Lab Studios Console (the back office) | a Claude page, with the engine creative-lab-engine | Cloudflare |

Never Netlify. The old Business console is retired.

## Machines (home network, reached over Tailscale)

| Machine | What it does |
|---|---|
| NUC (Windows) | Control desk: the code, scheduled jobs, the E: drive design library |
| Blink (Ubuntu) | Runs Alice and Steve and a copy of the console. First choice for AI jobs |
| GMKtec (Windows) | Small overnight jobs on a small model. Backup for the daily brief |
| Dell (ZimaOS) | File server: backups, photos, video. No AI |

## Agents

- Alice: Aaron's personal assistant. The only agent that reads his email, calendar and notes. That information never goes to Steve or anyone else.
- Steve: the business agent for both brands. Drafts and answers only. A code checker reads every answer.
- Claude: judgment calls (ads, tricky customers), research and building.
- The team board is how agents leave each other notes. Never a customer's contact details and never a key on it.

## Where things are kept

- Rules: CLAUDE.md. Marketing playbook: MARKETING-CONTEXT.md. To-do list: OPEN-ITEMS.md. All in Creative Lab HQ on the NUC.
- Drafts waiting for Aaron: the "Drafts - needs OK" folder, one folder per brand.
- Prices: the price sheet (Google Sheets). It is the only source.
- Art and logos: Kittl, and the design library on the E: drive.
- If something breaks: Creative Lab HQ, folder 00 Recovery, two guides.
- Social accounts: Charleston3D is @charleston3d, Elevated Designs is @elevated_designs_sc. Posting is done in Holo.
""")


card("design-engineer",
     "Designing printable 3D parts for Charleston3D in Fusion: which ready-made recipe to use, the sizes it accepts, and the rules for parts that print well.",
     ["Fusion", "3D design", "CAD", "recipe", "print rules", "Charleston3D"], """
# Design engineer: Fusion for Charleston3D

Fusion comes first because it is free. Meshy costs credits: last resort, only with Aaron's OK. Sizes are millimetres.

## Pick the recipe

| The request | Recipe | Sizes it accepts (mm) |
|---|---|---|
| A sign, name plate, key tag, label | plate | text up to 40 letters; width 20 to 250; height 10 to 250; thickness 1 to 20; textSize 3 to 120; textDepth 0.4 to 10; holes: none, keyring or screws |
| A box, bin, tray, holder, organizer | box | width and depth 10 to 250; height 5 to 250; wall 0.8 to 10; corner 0 to 30; lid yes or no |
| A logo or ornament from an SVG drawing | svg | width 5 to 250; thickness 0.6 to 50 |
| A library file bigger, smaller or in another format | resize | longest side 0 to 300 (0 keeps the size) |
| Anything else: curves, fits, threads, several parts | script | Claude writes it. Never force a shape into a recipe |

A message that starts with "Design in Fusion:" is turned into a job. Code checks your answer (recipe, sizes in range, walls, text fit) before anything is built. The NUC builds it in Fusion and saves it to the 3D file library, tagged "made with Fusion".

## Rules for parts that print well (0.4 mm nozzle, PLA or PETG)

- Bed: 256 x 256 x 256. Bigger parts are split or scaled down.
- Walls: at least 1.2. 2 or more for boxes and anything people handle. Never under 0.8.
- Plates and tags: at least 2 thick; key tags 3 to 4. Key ring hole at least 4 across and 3 from the edge.
- Text: raised 0.8 to 1.5, letters at least 5 tall (8 or more for thin fonts). Fit check: each letter is about 0.7 x the letter height wide, so the text must be narrower than the plate.
- Overhangs under 45 degrees, or plan supports. Bridges up to about 20.
- Every part needs a flat side on the bed. Height over 4 times the base: add a brim.
- Fits: a lid or sliding part needs 0.2 to 0.3 gap per side. Holes print about 0.2 small: draw them 0.2 bigger.
- Round outside corners 2 or more on things people hold.

## For a custom request

1. Find the size, the words, the colors and what it is for. A missing size: ask for it, do not guess.
2. Pick the recipe and the sizes. If none fits, say it is a script job for Claude.
3. Read the print check on the finished part and fix what it marks: thicker walls, smaller text, split it.

## Never

- State a price. Aaron quotes custom work.
- Use Fusion's picture as a product photo. It is a preview for the Lab only (see photo-real-images).
- Design logos, team names or characters we do not own.
""")


def render(name):
    description, tags, body = CARDS[name]
    return ("---\nname: %s\ndescription: \"%s\"\nversion: 2.0.0\nmetadata:\n  hermes:\n    tags: [%s]\n---\n\n%s"
            % (name, description.replace('"', "'"), ", ".join(tags), body))


if __name__ == "__main__":
    for name in CARDS:
        d = HERE / name
        d.mkdir(exist_ok=True)
        (d / "SKILL.md").write_text(render(name), encoding="utf-8", newline="\n")
        print("%-22s %5d chars" % (name, len(CARDS[name][2])))
