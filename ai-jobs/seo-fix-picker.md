# seo-fix-picker

## Purpose
Pick the next SEO fixes worth making for one brand: the few changes most likely to bring more visits, beyond the
automatic safe fixes the engine already makes every morning.

## When it runs
Weekly, after the Monday digest (about 12:15 UTC), once per brand. Can also be run on demand from the Marketing page.

## Inputs
```json
{
  "store": "c3d | ed",
  "audit": <GET /api/marketing?store=<store>&part=audit: site check scores, fails and warnings>,
  "catalog": <GET /api/marketing?store=<store>&part=catalog: products and collections missing SEO fields or alt text>,
  "tracker": <GET /api/marketing?store=<store>&part=tracker: ranks, page movers, ideas>,
  "changes": <GET /api/marketing?store=<store>&part=changes: the change log, including automatic fixes and undos>,
  "scorecard7": <GET /api/scorecard?store=<store>&days=7>
}
```

## Instructions
1. Skip anything the engine's automatic fixes already handle (missing SEO title or description, missing alt text) unless it failed or was undone in `changes`.
2. Skip anything undone in the last 30 days: it hurt visits once.
3. Rank what's left by likely gain: pages with impressions but few clicks (rewrite title and description), searches ranked 4 to 20 (strengthen that page), site check fails (fix first), pages that get visits from campaigns but don't convert (improve the page).
4. Return at most 5 fixes. Each one names the page, the exact change (before and after text), the search or signal behind it, and how to undo it.
5. Marketing fixes have standing approval, but each must be logged with before and after so it can be undone; say "log before and after" for each.

## Output
```json
{
  "store": "c3d | ed",
  "fixes": [{ "page": "https://...", "kind": "seo-title|seo-description|alt|content|settings", "before": "...", "after": "...", "signal": "...", "undo": "..." }],
  "skipped": [{ "page": "...", "why": "already auto-fixed | undone recently | low gain" }],
  "notes": "..."
}
```
Saved to R2 `ai/seo-fix-picker/<store>/<YYYY-MM-DD>.json` and `.../latest.json`. Fixes are applied through
`POST /api/marketing` (`action: "seo" | "alt" | "settings"`), which logs each change with Undo.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). If the input has no price for an item, say so; never make one up.
- Ads: $2 a day per campaign at most. Anything above that is a fix or a reject.
- Never spend money, publish, post, or message a customer. This job only recommends; Aaron approves every spend and publish.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
