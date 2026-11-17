# post-captions

## Purpose
Draft one Instagram caption and one Facebook caption for one live product of one brand, from that product's own
listing text only. The drafts wait for Aaron's OK; nothing is posted.

## When it runs
Overnight on the NUC (task "Creative Lab overnight jobs", 12:40 AM Eastern), on the GMKtec's model: two products per
brand a night, so by morning there are drafts to pick from. It is not time sensitive, so the slow PC does it.

## Inputs
```json
{
  "store": "c3d | ed",
  "product": {
    "title": "the live listing title, unchanged",
    "description": "the live listing text, plain words",
    "price": 16.99, "priceVaries": false,
    "tags": ["..."]
  },
  "voice": "short brand voice notes for this store"
}
```
`product` is read from the store's public product list by scripts/overnight-jobs.mjs. The link (with its UTM tags)
and the brand's hashtags are added by code afterwards, so the model never writes a link or a hashtag in a caption.

## Instructions
1. Write two captions for the same product: one for Instagram (25 to 70 words) and one for Facebook (30 to 90 words). Different wording, same facts.
2. First line is a short hook about the product. Then what it is and who it is for, using only facts from `description`. End with one plain call to action such as "Link below." or "Order yours at the link."
3. Use only numbers that are in the input. Say the price only if `priceVaries` is false, and then exactly as given, with a dollar sign.
4. No links, no hashtags and no emoji inside the captions. A location, if used, is only "Charleston, SC".
5. Give 2 or 3 `topicTags` for this product's topic (one word each, starting with #, letters and numbers only). The brand's own hashtags are added by code; do not repeat them.
6. If the description is too thin to write from, say so in `notes` and keep the captions to what is known.

## Output
```json
{
  "store": "c3d | ed",
  "product": "the input title, unchanged",
  "posts": [
    { "platform": "instagram", "caption": "..." },
    { "platform": "facebook", "caption": "..." }
  ],
  "topicTags": ["#...", "#..."],
  "notes": "..."
}
```
Saved by code as a draft file in `Aaron-Data\_Drafts - needs OK\<brand>\Post drafts\`.

## Hard rules
- One brand per run: `c3d` (Charleston 3D) or `ed` (Elevated Designs). Never mention, link, price or compare the other brand, and never put both in one output.
- Nothing fake: real product photos only (a real blank or a real print, never a drawn shirt or object), no invented reviews, sales numbers, badges, awards or claims. No guarantees or shipping promises the listing does not make.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2), which here means the price in the input. If the input has no single price, do not state one; never make one up.
- Ads: a hard $2 a day in total across both brands, not per campaign, with one ad live at a time. This job never proposes an ad.
- Never spend money, publish, post, or message a customer. This job only drafts; Aaron approves every post.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file. Show only "Charleston, SC" as a location, never an address or phone number.
- Answer with JSON only, in the Output shape. If the input is missing something you need, say what in `notes` instead of guessing.
