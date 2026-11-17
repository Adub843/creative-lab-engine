// Tagged links for posts and ads. Every link to a store that goes out in a post or an ad carries UTM tags, so the
// scorecard (lib/scorecard.mjs) can tell which post or ad brought the visit and the order.
//
//   utm("https://elevatedshirts.com/products/tee", { source: "facebook", medium: "paid", campaign: "ed-holiday-tees", content: "photo-1" })
//   -> https://elevatedshirts.com/products/tee?utm_source=facebook&utm_medium=paid&utm_campaign=ed-holiday-tees&utm_content=photo-1
//
// Naming (keep it the same everywhere, or the scorecard splits one campaign into two):
//   source    where it's shown: facebook, instagram, tiktok, google, qr, email, social (a post to several places)
//   medium    paid (an ad that costs money) or organic (a free post), print (QR codes), email
//   campaign  lower-case words joined by "-"; this is the key used in ads/spend-<store>.json
//   content   optional: which picture or wording, to compare two versions of the same ad
// Values are trimmed, lower-cased and made URL-safe; empty ones are left out. Tags already on the link are replaced.
const clean = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

export function utm(url, { source, medium, campaign, content } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("utm() only tags https links.");
  for (const [k, v] of [["utm_source", source], ["utm_medium", medium], ["utm_campaign", campaign], ["utm_content", content]]) {
    const c = clean(v);
    if (c) u.searchParams.set(k, c);
    else u.searchParams.delete(k);
  }
  return u.toString();
}

// The link a new listing is shared with: a free social post, the product's handle as the campaign.
export const listingShareUrl = (url, handle) => utm(url, { source: "social", medium: "organic", campaign: handle, content: "new-listing" });
