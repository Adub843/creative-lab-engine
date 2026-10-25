// The Elevated Designs listing template: turns a library image into a ready-to-sell T-shirt
// listing (title, description, SEO, tags) that the "List it" sheet shows for editing.
// Plain functions with no page code, so the API tests check them too.
// Brand voice: clean, elevated, everyday. Only say what's true of every shirt: it's printed to
// order and ships in the handling time. The fabric line is a placeholder to edit per blank.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NOISE = /^(final|copy|v\d+|\d+x\d+|\d+|print|printfile|mockup|transparent|img|dsc|edit|edited|new|draft|export|hires|hi|res|png|jpe?g|webp|gif|svg)$/i;

export function cleanTitle(name = "") {
  const words = String(name).replace(/\.[a-z0-9]{2,5}$/i, "").split(/[\s_\-.()[\]]+/).filter((w) => w && !NOISE.test(w));
  const nice = words.map((w) => (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()));
  let title = nice.join(" ").trim() || "Graphic";
  if (!/\b(tee|t-shirt|shirt)\b/i.test(title)) title += " Tee";
  return title.slice(0, 120);
}

const designName = (title) => title.replace(/\s+(graphic\s+)?(tee|t-shirt|shirt)$/i, "").trim() || title;
export const sizeRange = (sizes) => (sizes.length > 1 ? `${sizes[0]} to ${sizes.at(-1)}` : sizes[0] ?? "");

// Cuts at a word boundary so it fits Shopify's search snippet limits.
export function fit(text, max) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:|–-]+$/, "");
}

export function describe({ title, fabric, handlingDays, sizes, upcharges = {} }) {
  const extra = Object.entries(upcharges).filter(([s, v]) => sizes.includes(s) && v > 0).map(([s, v]) => `${s} +$${Number(v).toFixed(v % 1 ? 2 : 0)}`);
  return [
    `<p><strong>${esc(designName(title))}</strong>: an original Elevated Designs graphic with clean lines, made to be worn every day.</p>`,
    "<ul>",
    `<li>${esc(fabric)}</li>`,
    `<li>Unisex sizes ${esc(sizes.join(", "))}${extra.length ? ` (${esc(extra.join(", "))})` : ""}</li>`,
    `<li>Printed to order for you; ships in ${esc(handlingDays)} business days</li>`,
    "</ul>",
  ].join("\n");
}

export function seoFor({ title, fabric, handlingDays, sizes }) {
  const brand = " | Elevated Designs";
  const seoTitle = title.length + brand.length <= 60 ? title + brand : fit(title, 60);
  const seoDescription = fit(`${designName(title)} graphic tee by Elevated Designs. ${fabric}, printed to order in sizes ${sizeRange(sizes)}. Ships in ${handlingDays} business days.`, 155);
  return { seoTitle, seoDescription };
}

export function tagsFor(item, tpl) {
  const out = [];
  for (const raw of [...tpl.tags, ...String(item?.tags ?? "").split(",")]) {
    const t = raw.trim().slice(0, tpl.limits?.tag ?? 40);
    if (!t || /^design:/i.test(t) || t.toLowerCase() === "customizable") continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, tpl.limits?.tags ?? 25);
}

export function buildListing(item, tpl) {
  const title = cleanTitle(item?.name);
  const base = { title, fabric: tpl.fabric, handlingDays: tpl.handlingDays, sizes: tpl.sizes, upcharges: tpl.upcharges };
  return { ...base, price: tpl.price, productType: tpl.productType, tags: tagsFor(item, tpl), descriptionHtml: describe(base), ...seoFor(base) };
}
