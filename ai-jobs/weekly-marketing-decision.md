# weekly-marketing-decision

## Purpose
Once a week, per brand, read how the posts and ads did and decide what to keep, stop or try, and write next week's
post and ad plan. This is the judgment step of the feedback loop; the numbers themselves are plain code.

## When it runs
Weekly, Monday after the 11:30 UTC digest (about 12:00 UTC), once for `c3d` and once for `ed`, as two separate runs.

## Inputs
```json
{
  "store": "c3d | ed",
  "scorecard7": <GET /api/scorecard?store=<store>&days=7>,
  "scorecard2": <GET /api/scorecard?store=<store>&days=2>,
  "digest": <GET /api/digest, only stores[<store>]>,
  "search": <GET /api/marketing?store=<store>&part=traffic and part=tracker: search queries, ranks, page movers>,
  "keywords": <GET /api/marketing?store=<store>&part=keywords>,
  "trends": <R2 research/trends-<store>.json if present: [{ "topic": "...", "direction": "up|flat|down", "source": "..." }]>,
  "events": <R2 research/events-<store>.json if present (the market calendar): [{ "date": "2026-11-28", "name": "...", "where": "Charleston, SC" }]>,
  "lastDecision": <R2 ai/weekly-marketing-decision/<store>/latest.json, or null>
}
```
The scorecard shape (both windows):
```json
{
  "store": "c3d", "days": 7, "since": "2026-11-02", "until": "2026-11-08", "currency": "USD",
  "limits": { "maxCostPerVisit": 0.5, "maxDailyBudget": 2 },
  "totals": { "sessions": 200, "cartAdds": 17, "checkouts": 10, "completedCheckouts": 8, "orders": 10, "sales": 270, "conversionRate": 5 },
  "average": { "conversionRate": 5, "costPerVisit": 0.3, "costPerOrder": 3.5 },
  "campaigns": [ { "campaign": "holiday-ornaments", "paid": true, "sources": [{ "source": "facebook", "medium": "paid", "sessions": 30 }],
                   "sessions": 40, "cartAdds": 7, "checkouts": 5, "orders": 4, "sales": 100, "conversionRate": 10,
                   "cost": 14, "dailyBudget": 2, "costPerVisit": 0.35, "costPerOrder": 3.5,
                   "label": "winner|average|loser", "pauseRecommended": false, "flags": ["no_visits|cost_per_visit|over_daily_cap"], "reasons": ["..."] } ],
  "pauseRecommended": ["campaign"], "overCap": ["campaign"], "errors": { "sessions": "...", "orders": "...", "spend": "..." }, "missingScopes": ["read_reports"]
}
```

## Instructions
1. Start with the scorecard flags. Every campaign in `pauseRecommended` goes in `stop`, and every one in `overCap` goes in `fixBudget`. Don't argue with these; they are rules.
2. For each other campaign: a `winner` in the 7-day scorecard that isn't a `loser` in the 2-day one goes in `keep` (paid winners may keep their budget, never above $2/day). A `loser` goes in `stop`. An `average` with fewer than 10 visits stays one more week, marked "too early".
3. Read `search`, `keywords`, `trends` and `events` for what people are looking for now: rising searches, pages that moved up, upcoming local events. Pick at most three ideas to `try`, each tied to one of these signals. Say which signal.
4. Compare with `lastDecision`: if something you said to try last week has no visits now, say so and don't suggest it again unchanged.
5. Write next week's plan: up to 5 free posts and up to 2 ads. Each item names the product(s), the channel, the angle, the day, and the exact tagged link (`utm_source`, `utm_medium` = `organic` or `paid`, `utm_campaign`). Every ad has `dailyBudget` of 2 or less. Total ad spend for the week is the sum of the budgets x days; state it.
6. Every plan item still goes through `marketing-qa` and Aaron's approval before it is posted or paid for. Say so in `nextSteps`.
7. If the scorecard has `errors` or `missingScopes`, list them in `notes` and base decisions only on what is there.

## Output
```json
{
  "store": "c3d | ed",
  "week": "2026-11-09",
  "keep": [{ "campaign": "...", "why": "..." }],
  "stop": [{ "campaign": "...", "why": "..." }],
  "fixBudget": [{ "campaign": "...", "from": 5, "to": 2 }],
  "try": [{ "idea": "...", "signal": "search|trend|event|scorecard", "evidence": "..." }],
  "plan": [{ "kind": "post|ad", "channel": "...", "day": "2026-11-10", "products": ["handle"], "angle": "...", "link": "https://...?utm_source=...&utm_medium=...&utm_campaign=...", "dailyBudget": 0, "days": 0 }],
  "weeklyAdSpend": 14,
  "nextSteps": ["Run marketing-qa on each plan item", "Aaron approves the ads and their budgets"],
  "notes": "..."
}
```
Saved to R2 `ai/weekly-marketing-decision/<store>/<YYYY-MM-DD>.json` and `.../latest.json`. The console shows it on the Marketing page.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). If the input has no price for an item, say so; never make one up.
- Ads: $2 a day per campaign at most. Anything above that is a fix or a reject.
- Never spend money, publish, post, or message a customer. This job only recommends; Aaron approves every spend and publish.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
