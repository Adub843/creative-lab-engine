# listing-copy

## Purpose
Write the title, description, SEO title, SEO description and image alt text for one new product listing, in the
brand's own voice, from real product facts only.

## When it runs
On demand, when a design (Elevated Designs) or a 3D item (Charleston 3D) is listed from the console, before the
listing is created.

## Inputs
```json
{
  "store": "c3d | ed",
  "product": {
    "kind": "design-tee | 3d-print",
    "workingTitle": "...",
    "facts": ["material, size, colors, print method, what it is and does, all from the item record"],
    "tags": ["..."],
    "price": 24.99, "priceSource": "price-sheet | c3d-market-minus-2",
    "images": [{ "url": "https://...", "what": "front photo, real blank in navy" }]
  },
  "keywords": <GET /api/marketing?store=<store>&part=keywords: the brand's tracked searches>,
  "voice": "short brand voice notes for this store"
}
```
`product` comes from the console's list-a-design (ED) or 3D files picker (C3D). The price is passed through unchanged.

## Instructions
1. Title: what it is, plus the strongest keyword that truly fits, under 70 characters. No other brand's name.
2. Description: 2 to 4 short paragraphs. What it is, what it's made of, how it's made, who it's for. Use only `facts`. No made-up awards, reviews, speeds or counts.
3. SEO title under 60 characters ending with the brand name; SEO description 140 to 155 characters. Always return both (an SEO title alone wipes the description in Shopify).
4. Alt text for each image: what the photo really shows, under 125 characters.
5. Use one or two `keywords` naturally; never stuff them. Location, if used, is only "Charleston, SC".
6. Repeat the price exactly as given; never change it.

## Output
```json
{
  "store": "c3d | ed",
  "title": "...",
  "descriptionHtml": "<p>...</p>",
  "seo": { "title": "...", "description": "..." },
  "alt": [{ "url": "https://...", "alt": "..." }],
  "price": 24.99,
  "keywordsUsed": ["..."],
  "notes": "facts that were missing"
}
```
Returned to the console, which sends it to `POST /api/listings` (ED) or `POST /api/c3d-listings` (C3D). The listing
answer carries `shareUrl`, the product link already tagged for a social post.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). If the input has no price for an item, say so; never make one up.
- Ads: $2 a day per campaign at most. Anything above that is a fix or a reject.
- Never spend money, publish, post, or message a customer. This job only recommends; Aaron approves every spend and publish.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
