# marketing-qa

## Purpose
Check every social post and ad before it goes out (to Holo, Meta or anywhere else) and answer pass, fix or reject,
with the reasons. This is the quality gate between "drafted" and "sent for Aaron's approval".

## When it runs
On demand, once for each post or ad, before it is queued in Holo or Meta. A rejected or fixed item is checked again
after it is changed. Nothing goes out without a `pass`.

## Inputs
```json
{
  "store": "c3d | ed",
  "item": {
    "id": "draft id from the console",
    "kind": "post | ad",
    "channel": "facebook | instagram | tiktok | google | other",
    "text": "the caption or ad copy, exactly as it will appear",
    "headline": "ad headline, or null",
    "link": "https://... the link in the post (must carry utm_source, utm_medium, utm_campaign)",
    "images": [{ "url": "https://...", "source": "shopify-product | kittl-mockup | photo | other", "productHandle": "handle or null" }],
    "products": [{ "handle": "...", "title": "...", "price": 24.99, "priceSource": "price-sheet | c3d-market-minus-2 | shopify-live" }],
    "claims": ["each factual claim in the text, e.g. 'ships in 3 days', 'made in Charleston'"],
    "budget": { "dailyBudget": 2, "days": 7 }
  },
  "facts": {
    "livePrices": { "<handle>": 24.99 },
    "shipping": "the store's real shipping and handling times",
    "brandColors": ["#15223f", "..."]
  }
}
```
Sources: `item` is the draft from the console (Creative Lab Studios marketing page). `facts.livePrices` comes from
`GET /api/products?store=<store>` (the engine). Shipping and handling come from the store's own settings or policy pages.
`budget` is null for a free post.

## Instructions
1. Check the brand. The text, images, link and hashtags must all belong to `store` only. The other brand's name, products, site or colors anywhere means `reject`.
2. Check the look. Images must be real product photos or real mockups made from a real blank photo. A drawn, clip-art or cartoon product, fake badges, stock-looking filler or placeholder text means `reject`.
3. Check every price. Each price in the text must equal `facts.livePrices` for that product and have a `priceSource` of `price-sheet` (Elevated Designs) or `c3d-market-minus-2` (Charleston 3D) or `shopify-live`. A price that doesn't match, or has no source, means `fix` (give the right price if the input has it).
4. Check the link. It must go to this store's own domain and carry `utm_source`, `utm_medium` and `utm_campaign`. For an ad, `utm_medium` is `paid`; for a free post, `organic`. Missing or wrong tags mean `fix`, and give the corrected link.
5. Check the budget. An ad with `dailyBudget` above 2 means `fix` (lower it to 2 or less). A free post must have no budget.
6. Check the claims. Each claim must be backed by `facts`. A claim that can't be backed (speed, awards, "best in", counts of customers, reviews) means `fix` (remove or soften it); a false one means `reject`.
7. Check the basics: spelling, a clear call to action, no street address or phone number, no personal email.
8. The verdict is the worst result of steps 1 to 7: any `reject` makes it `reject`, else any `fix` makes it `fix`, else `pass`.

## Output
```json
{
  "store": "c3d | ed",
  "id": "the draft id",
  "verdict": "pass | fix | reject",
  "checks": { "brand": "pass|fix|reject", "look": "...", "price": "...", "utm": "...", "budget": "...", "claims": "...", "basics": "..." },
  "reasons": ["one short sentence per problem found"],
  "fixes": { "text": "corrected text or null", "link": "corrected link or null", "dailyBudget": 2 },
  "notes": "anything the input was missing"
}
```
Saved to R2 `ai/marketing-qa/<store>/<draft id>.json` and shown on the draft in the console. Only a `pass` can be sent on for Aaron's approval.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). If the input has no price for an item, say so; never make one up.
- Ads: $2 a day per campaign at most. Anything above that is a fix or a reject.
- Never spend money, publish, post, or message a customer. This job only recommends; Aaron approves every spend and publish.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
