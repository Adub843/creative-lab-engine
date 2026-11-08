# review-summary

## Purpose
Sum up what customers said in reviews and messages for one brand: what they like, what they complain about, and what
to change in listings, photos or posts because of it.

## When it runs
Weekly, Monday about 12:30 UTC, once per brand, before `weekly-marketing-decision` reads it the next week.

## Inputs
```json
{
  "store": "c3d | ed",
  "reviews": <R2 research/reviews-<store>.json: [{ "date": "2026-11-01", "rating": 5, "text": "...", "product": "handle or null", "where": "google|shopify|etsy|facebook" }]>,
  "requests": <C3D only, optional: custom request notes from $0 "Custom request" orders, text only, no names or contact details>
}
```
`research/reviews-<store>.json` is written by an export script or the ops agent from the review sources; the engine
has no reviews route yet. Customer names, emails and phone numbers are removed before the file is written.

## Instructions
1. Group the comments into themes (quality, fit, print, shipping time, price, service, ideas). Count how many comments fall in each, and the average rating per theme.
2. For each theme, quote one or two short, real phrases from the input. Never invent or reword a quote, and never include a customer's name.
3. Turn the complaints into at most 3 concrete changes (a listing fact to add, a photo to retake, a size chart, a shipping note), each tied to a theme.
4. Pick at most 3 real, positive quotes that could be used in posts, only if the reviewer's words are quoted exactly; mark them "needs Aaron's OK before use".
5. If there are fewer than 5 reviews, say so and keep it short.

## Output
```json
{
  "store": "c3d | ed",
  "period": { "from": "2026-11-01", "to": "2026-11-08" },
  "count": 0, "averageRating": null,
  "themes": [{ "theme": "...", "count": 0, "averageRating": 0, "quotes": ["..."] }],
  "changes": [{ "change": "...", "theme": "..." }],
  "postQuotes": [{ "quote": "...", "rating": 5, "status": "needs Aaron's OK before use" }],
  "notes": "..."
}
```
Saved to R2 `ai/review-summary/<store>/<YYYY-MM-DD>.json` and `.../latest.json`.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). If the input has no price for an item, say so; never make one up.
- Ads: $2 a day per campaign at most. Anything above that is a fix or a reject.
- Never spend money, publish, post, or message a customer. This job only recommends; Aaron approves every spend and publish.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
