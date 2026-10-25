// The Elevated Designs listing template: turns a library image into a ready-to-sell listing
// (title, description, SEO, tags, and which blanks, colors and sizes to offer) that the
// "List it" sheet shows for editing. Plain functions with no page code: lib/listings.mjs uses the
// same ones on the server, and the API tests check them.
// Brand voice: clean, elevated, everyday. Only say what's true of every shirt (printed to order,
// ships in the handling time) and what the blank catalog says about each blank.

export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
export const MAX_VARIANTS = 2048; // Shopify's limit per product
export const STANDARD_VARIANTS = 100; // stores without extended variants stop here
export const OPTION_NAMES = ["Blank", "Color", "Size"];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const NOISE = /^(final|copy|v\d+|\d+x\d+|\d+|print|printfile|mockup|transparent|img|dsc|edit|edited|new|draft|export|hires|hi|res|png|jpe?g|webp|gif|svg)$/i;

export function cleanTitle(name = "") {
  const words = String(name).replace(/\.[a-z0-9]{2,5}$/i, "").split(/[\s_\-.()[\]]+/).filter((w) => w && !NOISE.test(w));
  const nice = words.map((w) => (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()));
  let title = nice.join(" ").trim() || "Graphic";
  if (!/\b(tee|t-shirt|shirt|hoodie|sweatshirt|tank)\b/i.test(title)) title += " Tee";
  return title.slice(0, 120);
}

// ---------- blanks ----------
// "Gildan 5000 – Heavy Cotton Tee": the Blank option value, unique per blank in the catalog.
export const blankLabel = (b) => `${b.brand} ${b.style} – ${b.name}`;
export const colorSlug = (name) => String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "color";
export const sku = (imageKey, blankId, color, size) => `${imageKey}-${blankId}-${colorSlug(color)}-${size}`;
const minPrice = (b) => Math.min(...Object.values(b.prices));

// Black, white, navy and a grey or heather where the blank has them; otherwise its first colors.
const PRESET = [/^(jet )?black$/i, /^white$/i, /navy/i, /(sport grey|athletic heather|heather gr[ae]y|^gr[ae]y$|grey heather|heather)/i];
export function presetColors(blank, n = 4) {
  const names = blank.colors.map((c) => c.name);
  const out = [];
  for (const re of PRESET) { const hit = names.find((c) => re.test(c) && !out.includes(c)); if (hit) out.push(hit); }
  for (const c of names) { if (out.length >= n) break; if (!out.includes(c)) out.push(c); }
  return out.slice(0, n);
}

// The cheapest tee in each tier (value, standard, premium), ties broken by blank cost.
export function defaultBlanks(catalog) {
  const out = [];
  for (const tier of Object.keys(catalog.tiers)) {
    const tees = catalog.blanks.filter((b) => b.type === "tee" && b.tier === tier)
      .sort((a, b) => minPrice(a) - minPrice(b) || (a.cost?.base ?? 0) - (b.cost?.base ?? 0));
    if (tees[0]) out.push({ id: tees[0].id, colors: presetColors(tees[0]) });
  }
  return out;
}

// Every variant a selection makes, in option order: blank, then color, then size.
export function variantsFor(catalog, { blanks, sizes, markup = 0 }) {
  const out = [];
  for (const sel of blanks) {
    const b = catalog.blanks.find((x) => x.id === sel.id);
    if (!b) continue;
    const sz = SIZES.filter((s) => sizes.includes(s) && b.sizes.includes(s));
    for (const color of sel.colors) for (const size of sz)
      out.push({ blank: b, color, size, price: Math.round((b.prices[size] + markup) * 100) / 100 });
  }
  return out;
}
export const variantCount = (catalog, sel) => variantsFor(catalog, sel).length;

// ---------- copy ----------
const designName = (title) => title.replace(/\s+(graphic\s+)?(tee|t-shirt|shirt)$/i, "").trim() || title;
export const sizeRange = (sizes) => { const s = SIZES.filter((x) => sizes.includes(x)); return s.length > 1 ? `${s[0]} to ${s.at(-1)}` : s[0] ?? ""; };

// Cuts at a word boundary so it fits Shopify's search snippet limits.
export function fit(text, max) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:|–-]+$/, "");
}

const offered = (catalog, blanks) => blanks.map((s) => catalog.blanks.find((b) => b.id === s.id)).filter(Boolean);
const lower = (s) => String(s ?? "").replace(/^\w/, (c) => c.toLowerCase());

export function describe({ title, handlingDays, catalog, blanks, sizes }) {
  const list = offered(catalog, blanks);
  const shirts = list.map((b) => `<li><strong>${esc(blankLabel(b))}</strong>: ${esc([b.fabric, b.weightOz ? `${b.weightOz} oz` : null, b.fit ? `${lower(b.fit)} fit` : null].filter(Boolean).join(", "))}</li>`);
  return [
    `<p><strong>${esc(designName(title))}</strong>: an original Elevated Designs graphic with clean lines, made to be worn every day.</p>`,
    "<h3>Choose your shirt</h3>",
    "<ul>", ...shirts, "</ul>",
    `<p>Sizes ${esc(sizeRange(sizes))}, depending on the shirt. Printed to order for you; ships in ${esc(handlingDays)} business days.</p>`,
  ].join("\n");
}

export function seoFor({ title, handlingDays, sizes }) {
  const brand = " | Elevated Designs";
  const seoTitle = title.length + brand.length <= 60 ? title + brand : fit(title, 60);
  const seoDescription = fit(`${designName(title)} graphic tee by Elevated Designs. Pick your shirt and color; printed to order in sizes ${sizeRange(sizes)}. Ships in ${handlingDays} business days.`, 155);
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
  const blanks = tpl.defaults.blanks.map((b) => ({ id: b.id, colors: [...b.colors] }));
  const sizes = [...tpl.defaults.sizes];
  const base = { title, handlingDays: tpl.handlingDays, catalog: tpl.catalog, blanks, sizes };
  return { title, blanks, sizes, markup: 0, productType: tpl.productType, tags: tagsFor(item, tpl), descriptionHtml: describe(base), ...seoFor(base) };
}
