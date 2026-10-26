// Marketing for each store: monitors, tracks and adjusts SEO, GEO (local and AI search), Bing and
// analytics. Plain functions with no hosting code, like lib/shopify.mjs.
//
//   GET  /api/marketing?store=c3d|ed&part=audit     checks the public site (no Shopify settings needed)
//                                     part=catalog   product and collection SEO, image alt text
//                                     part=settings  the live theme's Search and AI, Location and Analytics settings
//                                     part=traffic   visits by source and UTM campaign, Bing and Google search queries
//   POST /api/marketing {store, action: "seo" | "alt" | "settings" | "indexnow", ...}
//
// The two brands never share a request: every call names its store, uses that store's own site,
// Shopify, IndexNow key and search properties, and history is kept per store.
import {
  HttpError, STORES, adminClient, fail, fetchWithTimeout, indexNowKey, indexNowKeyLocation, ok, parseStore,
  pingIndexNow, readJsonBody, requireKey, siteUrl, storeConfig, userErrorsOrThrow,
} from "./shopify.mjs";

const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; BusinessConsole-SEO/1.0; +https://github.com/Adub843/Business-console)";
export const AREAS = {
  seo: "Search (Google)",
  geo: "Local (Charleston, SC)",
  bing: "Bing and IndexNow",
  ai: "AI assistants",
  analytics: "Analytics and tracking",
};
// Crawlers that must be able to read the site. AI assistants cite what their search crawlers can read.
export const CRAWLERS = [
  ["Googlebot", "seo"], ["Bingbot", "bing"],
  ["GPTBot", "ai"], ["OAI-SearchBot", "ai"], ["ChatGPT-User", "ai"], ["ClaudeBot", "ai"], ["Claude-SearchBot", "ai"],
  ["PerplexityBot", "ai"], ["Google-Extended", "ai"], ["Applebot-Extended", "ai"], ["Amazonbot", "ai"],
];
// Short pitch used in suggested descriptions. Facts only (both themes say the same).
const PITCH = {
  c3d: "Designed and 3D printed to order in Charleston, SC. Ships in 5-7 business days.",
  ed: "Printed to order in Charleston, SC. Ships across the US.",
};

// How each theme writes its own name (theme setting brand_name).
const BRAND_NAME = { c3d: "Charleston3D", ed: "Elevated Designs" };

// ---------- fetching the public site ----------
async function readCapped(res, max) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (size > max) { await reader.cancel().catch(() => {}); break; }
  }
  return text + decoder.decode();
}
export async function getPage(fetchImpl, url) {
  try {
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { "user-agent": UA, accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow" }, PAGE_TIMEOUT_MS);
    return { url, finalUrl: res.url || url, status: res.status, type: res.headers.get("content-type") ?? "", body: await readCapped(res, MAX_PAGE_BYTES) };
  } catch (e) {
    return { url, finalUrl: url, status: 0, type: "", body: "", error: e?.name === "AbortError" ? "timed out" : "couldn't connect" };
  }
}

// ---------- small HTML helpers (regex based; enough for checking our own two themes) ----------
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
};
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const visibleText = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
function meta(html, key) {
  for (const t of tagsOf(html, "meta")) {
    const n = (attr(t, "name") || attr(t, "property") || "").toLowerCase();
    if (n === key.toLowerCase()) return attr(t, "content");
  }
  return null;
}
function linkRel(html, rel, type) {
  for (const t of tagsOf(html, "link"))
    if ((attr(t, "rel") || "").toLowerCase().split(/\s+/).includes(rel) && (!type || (attr(t, "type") || "").toLowerCase() === type)) return attr(t, "href");
  return null;
}
function ldTypes(node, out) {
  if (Array.isArray(node)) node.forEach((n) => ldTypes(n, out));
  else if (node && typeof node === "object") {
    for (const t of [].concat(node["@type"] ?? [])) out.add(String(t));
    for (const [k, v] of Object.entries(node)) {
      if (k === "streetAddress" && v) out.add("!streetAddress");
      if (k === "telephone" && v) out.add("!telephone");
      if (k === "areaServed" && v) out.add("!areaServed");
      ldTypes(v, out);
    }
  }
  return out;
}

// Reads what search engines see on one page.
export function readPage(html) {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const types = new Set();
  let ldBlocks = 0, ldBroken = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    ldBlocks++;
    try { ldTypes(JSON.parse(m[1]), types); } catch { ldBroken++; }
  }
  const imgs = tagsOf(html, "img");
  const text = visibleText(html);
  return {
    title,
    description: (meta(head, "description") ?? "").trim(),
    h1: (html.match(/<h1\b/gi) ?? []).length,
    canonical: linkRel(head, "canonical"),
    robots: (meta(head, "robots") ?? "").toLowerCase(),
    og: { title: meta(head, "og:title"), description: meta(head, "og:description"), image: meta(head, "og:image"), url: meta(head, "og:url") },
    twitterCard: meta(head, "twitter:card"),
    geoRegion: meta(head, "geo.region"), geoPlace: meta(head, "geo.placename"),
    googleVerification: meta(head, "google-site-verification"),
    bingVerification: meta(head, "msvalidate.01"),
    llmsLink: linkRel(head, "alternate", "text/plain"),
    ldBlocks, ldBroken,
    ldTypes: [...types].filter((t) => !t.startsWith("!")).sort(),
    ldStreetAddress: types.has("!streetAddress"), ldTelephone: types.has("!telephone"), ldAreaServed: types.has("!areaServed"),
    images: imgs.length, imagesNoAlt: imgs.filter((t) => attr(t, "alt") == null).length,
    ga4: /["']G-[A-Z0-9]{4,15}["']/.test(html),
    // The themes' analytics snippet ends with })("<GA4 id>", "<Clarity id>");
    clarity: /\}\)\(\s*(?:"[^"]*"|null)\s*,\s*"[a-z0-9]{6,20}"\s*\)/.test(html),
    liquidError: /Liquid (?:syntax )?error/i.test(html),
    phoneInText: /(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(text),
  };
}

// ---------- robots.txt ----------
// Groups of user agents with their Allow/Disallow lines (RFC 9309). A crawler follows the group
// that names it, or the * group when none does.
export function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  const sitemaps = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap") sitemaps.push(value);
    else if ((field === "allow" || field === "disallow") && cur) cur.rules.push({ allow: field === "allow", path: value });
  }
  return { groups, sitemaps };
}
export function crawlerBlocked(robots, agent) {
  const a = agent.toLowerCase();
  const named = robots.groups.filter((g) => g.agents.includes(a));
  const rules = (named.length ? named : robots.groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  // Is the home page blocked? The longest matching rule wins; Allow wins a tie.
  let best = null;
  for (const r of rules) {
    if (r.path === "" ) continue; // "Disallow:" with nothing blocks nothing
    if (!"/".startsWith(r.path.replace(/\*$/, "").replace(/\$$/, ""))) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return Boolean(best && !best.allow);
}

// ---------- sitemap ----------
const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
export async function sitemapUrls(fetchImpl, site, { maxChildren = 10, maxUrls = 1000, host = new URL(site).host } = {}) {
  const index = await getPage(fetchImpl, `${site}/sitemap.xml`);
  if (index.status !== 200) return { ok: false, status: index.status, children: [], urls: [] };
  const same = (u) => { try { return new URL(u).host === host; } catch { return false; } };
  if (!/<sitemapindex/i.test(index.body)) return { ok: true, status: 200, children: [], urls: locs(index.body).filter(same).slice(0, maxUrls) };
  const children = locs(index.body).filter(same).slice(0, maxChildren);
  const urls = [];
  for (const child of children) {
    if (urls.length >= maxUrls) break;
    const c = await getPage(fetchImpl, child);
    if (c.status === 200) for (const u of locs(c.body)) if (same(u) && urls.length < maxUrls) urls.push(u);
  }
  return { ok: true, status: 200, children, urls };
}

// ---------- the site audit ----------
const check = (area, id, level, title, detail = "", fix = "") => ({ area, id, level, title, detail, fix });
export function scoreChecks(checks) {
  const scores = {};
  for (const area of Object.keys(AREAS)) {
    const list = checks.filter((c) => c.area === area);
    const pts = list.reduce((a, c) => a + (c.level === "pass" ? 1 : c.level === "warn" ? 0.5 : 0), 0);
    scores[area] = list.length ? Math.round((pts / list.length) * 100) : null;
  }
  const all = Object.values(scores).filter((v) => v != null);
  scores.overall = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
  return scores;
}

export function pageChecks(kind, url, p, out) {
  const where = kind === "home" ? "Home page" : kind === "product" ? "A product page" : "A collection page";
  const t = p.title.length;
  out.push(t >= 30 && t <= 60 ? check("seo", `${kind}-title`, "pass", `${where} title is ${t} characters`, p.title)
    : check("seo", `${kind}-title`, t ? "warn" : "fail", t ? `${where} title is ${t} characters (aim for 30 to 60)` : `${where} has no title`, p.title || url,
      kind === "home" ? "Set Homepage title in Site settings below." : "Edit its SEO title in Products and collections below."));
  const d = p.description.length;
  out.push(d >= 70 && d <= 160 ? check("seo", `${kind}-description`, "pass", `${where} description is ${d} characters`, p.description)
    : check("seo", `${kind}-description`, d ? "warn" : "fail", d ? `${where} description is ${d} characters (aim for 70 to 160)` : `${where} has no meta description`, p.description || url,
      kind === "home" ? "Set Description in Site settings below." : "Edit its SEO description in Products and collections below."));
  if (kind === "home") {
    out.push(p.h1 === 1 ? check("seo", "h1", "pass", "Home page has one main heading (h1)") : check("seo", "h1", "warn", `Home page has ${p.h1} main headings (h1); one is best`, "", "Keep one h1 (the hero heading) and make other section titles h2 in the theme."));
    out.push(p.canonical && /^https:\/\//.test(p.canonical) ? check("seo", "canonical", "pass", "Canonical address is set", p.canonical) : check("seo", "canonical", "fail", "No canonical address on the home page", "", "The theme's seo-meta snippet should print it; check the theme is published."));
    out.push(/noindex/.test(p.robots) ? check("seo", "noindex", "fail", "The home page tells search engines not to index it", p.robots, "Turn off the store password (Online Store > Preferences) and check the theme's robots meta.")
      : check("seo", "noindex", "pass", "The home page can be indexed", p.robots || "index, follow"));
    out.push(p.og.title && p.og.description && p.og.image ? check("seo", "og", "pass", "Social share card (Open Graph) is complete")
      : check("seo", "og", "warn", "Social share card is missing parts", ["og:title", "og:description", "og:image"].filter((k) => !p.og[k.slice(3)]).join(", "), "Set a Logo / social sharing image in the theme settings."));
    out.push(p.googleVerification ? check("seo", "google-verify", "pass", "Google Search Console verification tag is on the site")
      : check("seo", "google-verify", "warn", "No Google Search Console verification tag", "", "Add the site in Google Search Console and paste its code in Site settings below (or verify by DNS)."));
    const org = p.ldTypes.some((x) => /OnlineStore|LocalBusiness|Organization|Store/.test(x));
    out.push(org && p.ldTypes.includes("WebSite") ? check("seo", "schema-home", "pass", "Business and website structured data found", p.ldTypes.join(", "))
      : check("seo", "schema-home", "fail", "Business or website structured data is missing", p.ldTypes.join(", ") || "none", "The theme's structured-data snippet adds it; check the theme is published."));
    if (p.ldBroken) out.push(check("seo", "schema-broken", "fail", `${p.ldBroken} structured data block${p.ldBroken === 1 ? " doesn't" : "s don't"} parse`, "", "Run Google's Rich Results Test on the home page to see which."));
    if (p.liquidError) out.push(check("seo", "liquid", "fail", "The home page shows a Liquid error", "", "Open the theme editor and fix the section that shows the error."));
    out.push(p.imagesNoAlt ? check("seo", "home-alt", "warn", `${p.imagesNoAlt} of ${p.images} home page images have no alt text`, "", "Add alt text to the images in the theme editor.")
      : check("seo", "home-alt", "pass", "Every home page image has alt text"));
    // GEO
    out.push(p.geoRegion && p.geoPlace ? check("geo", "geo-meta", "pass", "Location tags are set", `${p.geoPlace}, ${p.geoRegion}`)
      : check("geo", "geo-meta", "fail", "Location tags (geo.region, geo.placename) are missing", "", "Set City and State in Site settings below."));
    out.push(p.ldAreaServed ? check("geo", "area-served", "pass", "Structured data lists the areas served")
      : check("geo", "area-served", "warn", "Structured data doesn't list areas served", "", "Fill Areas served in Site settings below (one town per line)."));
    out.push(!p.ldStreetAddress && !p.ldTelephone && !p.phoneInText ? check("geo", "privacy", "pass", "No street address or phone number is published (city only)")
      : check("geo", "privacy", "fail", "A street address or phone number appears on the site", [p.ldStreetAddress && "street address in structured data", p.ldTelephone && "telephone in structured data", p.phoneInText && "a phone number in the page text"].filter(Boolean).join(", "),
        "Both stores show the city only. Remove it from the theme settings or page text."));
    // Bing
    out.push(p.bingVerification ? check("bing", "bing-verify", "pass", "Bing Webmaster Tools verification tag is on the site")
      : check("bing", "bing-verify", "warn", "No Bing verification tag", "", "In Bing Webmaster Tools, import the site from Google Search Console, or paste the msvalidate.01 code in Site settings below."));
    // AI
    out.push(p.llmsLink ? check("ai", "llms-link", "pass", "Pages point AI assistants to llms.txt", p.llmsLink)
    : p.llmsLink === "" ? check("ai", "llms-link", "warn", "The llms.txt link on pages has an empty address", url, "The theme's llms link needs href=\"/llms.txt\".")
    : check("ai", "llms-link", "warn", "Pages don't link to llms.txt", "", "The theme adds the link when the llms page exists."));
    // Analytics
    out.push(p.ga4 ? check("analytics", "ga4", "pass", "Google Analytics 4 is installed") : check("analytics", "ga4", "warn", "Google Analytics 4 isn't installed", "", "Paste the G- measurement ID in Site settings below."));
    out.push(p.clarity ? check("analytics", "clarity", "pass", "Microsoft Clarity is installed") : check("analytics", "clarity", "warn", "Microsoft Clarity isn't installed", "Free heatmaps and session recordings.", "Paste the Clarity project ID in Site settings below."));
  }
  if (kind === "product") {
    out.push(p.ldTypes.includes("Product") && p.ldTypes.includes("Offer") ? check("seo", "schema-product", "pass", "Product pages have product and price structured data", url)
      : check("seo", "schema-product", "fail", "Product page is missing Product or Offer structured data", url, "Check the theme's structured-data snippet."));
  }
  if (kind !== "home")
    out.push(p.ldTypes.includes("BreadcrumbList") ? check("seo", `${kind}-breadcrumbs`, "pass", `${where} has breadcrumbs structured data`)
      : check("seo", `${kind}-breadcrumbs`, "warn", `${where} has no breadcrumbs structured data`, url));
}

export async function auditSite(fetchImpl, { store, site, key, clock = () => new Date() }) {
  const checks = [];
  const pages = [];
  const [home, robotsRes, llms, keyFile] = await Promise.all([
    getPage(fetchImpl, `${site}/`),
    getPage(fetchImpl, `${site}/robots.txt`),
    getPage(fetchImpl, `${site}/llms.txt`),
    key ? getPage(fetchImpl, indexNowKeyLocation(site, key)) : null,
  ]);
  // When the domain redirects elsewhere, read the sitemap as the visitor gets it.
  const siteHost = new URL(site).host;
  const liveHost = home.status === 200 ? new URL(home.finalUrl).host : siteHost;
  const sm = await sitemapUrls(fetchImpl, site, { maxChildren: 4, maxUrls: 400, host: liveHost });
  if (liveHost !== siteHost)
    checks.push(check("seo", "domain", "fail", `${siteHost} redirects to ${liveHost}`, home.finalUrl,
      `Search engines index ${liveHost}, not ${siteHost}. In Shopify Settings > Domains make ${siteHost} the primary domain (or set ${STORES[store].prefix}_SITE_URL to the one you keep). IndexNow only sends pages on ${siteHost}.`));

  if (home.status !== 200) {
    checks.push(check("seo", "home-up", "fail", `The home page answered ${home.status || home.error}`, site, "Check the domain is connected in Shopify and the store password is off."));
  } else {
    checks.push(check("seo", "home-up", "pass", "The site is up over HTTPS", home.finalUrl));
    const p = readPage(home.body);
    pages.push({ kind: "home", url: home.finalUrl, ...snippet(p) });
    pageChecks("home", home.finalUrl, p, checks);
    if (/password/.test(new URL(home.finalUrl).pathname)) checks.push(check("seo", "password", "fail", "The store is behind a password page", "", "Online Store > Preferences > turn off the password."));
  }

  // One product and one collection from the sitemap.
  const product = sm.urls.find((u) => /\/products\/[^/]+$/.test(new URL(u).pathname));
  const collection = sm.urls.find((u) => /\/collections\/[^/]+$/.test(new URL(u).pathname) && !/\/collections\/(all|frontpage)$/.test(u));
  const extra = await Promise.all([product, collection].map((u) => (u ? getPage(fetchImpl, u) : null)));
  [["product", extra[0]], ["collection", extra[1]]].forEach(([kind, r]) => {
    if (!r || r.status !== 200) return;
    const p = readPage(r.body);
    pages.push({ kind, url: r.finalUrl, ...snippet(p) });
    pageChecks(kind, r.finalUrl, p, checks);
  });

  // Sitemap and robots.txt
  checks.push(sm.ok ? check("seo", "sitemap", sm.urls.length ? "pass" : "warn", sm.urls.length ? `Sitemap lists ${sm.urls.length}${sm.urls.length >= 400 ? "+" : ""} pages` : "The sitemap lists no pages yet", `${site}/sitemap.xml`, sm.urls.length ? "" : "Make products Live in Products; Shopify adds them to the sitemap.")
    : check("seo", "sitemap", "fail", `sitemap.xml answered ${sm.status || "nothing"}`, `${site}/sitemap.xml`));
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : null;
  if (!robots) checks.push(check("seo", "robots", "fail", `robots.txt answered ${robotsRes.status || robotsRes.error}`, `${site}/robots.txt`));
  else {
    checks.push(robots.sitemaps.length ? check("seo", "robots-sitemap", "pass", "robots.txt points to the sitemap") : check("seo", "robots-sitemap", "warn", "robots.txt doesn't name the sitemap", "", "Keep Shopify's Sitemap: line in templates/robots.txt.liquid."));
    const blocked = CRAWLERS.filter(([a]) => crawlerBlocked(robots, a));
    for (const area of ["seo", "bing"]) {
      const bots = CRAWLERS.filter(([, ar]) => ar === area).map(([a]) => a);
      const bad = blocked.filter(([a]) => bots.includes(a)).map(([a]) => a);
      checks.push(bad.length ? check(area, `crawl-${area}`, "fail", `${bad.join(", ")} can't crawl the site`, "", "Fix templates/robots.txt.liquid in the theme.")
        : check(area, `crawl-${area}`, "pass", `${bots.join(", ")} can crawl the site`));
    }
    const ai = CRAWLERS.filter(([, ar]) => ar === "ai").map(([a]) => a);
    const aiBad = blocked.filter(([a]) => ai.includes(a)).map(([a]) => a);
    checks.push(aiBad.length ? check("ai", "crawl-ai", aiBad.length > 2 ? "fail" : "warn", `${aiBad.length} AI crawler${aiBad.length === 1 ? " is" : "s are"} blocked: ${aiBad.join(", ")}`, "", "Fix templates/robots.txt.liquid in the theme so AI assistants can read and cite the store.")
      : check("ai", "crawl-ai", "pass", `All ${ai.length} AI crawlers can read the site`, ai.join(", ")));
  }
  // llms.txt
  const brand = STORES[store].name.toLowerCase().replace(/\s+/g, "");
  if (llms.status === 200 && llms.body.trim().length > 200 && !/<html/i.test(llms.body.slice(0, 500)))
    checks.push(check("ai", "llms", llms.body.toLowerCase().replace(/\s+/g, "").includes(brand) ? "pass" : "warn", `llms.txt is live (${llms.body.length.toLocaleString("en-US")} characters)`, llms.finalUrl));
  else
    checks.push(check("ai", "llms", "fail", llms.status === 200 ? "llms.txt is empty or isn't plain text" : `llms.txt answered ${llms.status || llms.error}`, `${site}/llms.txt`,
      "Create page handle llms with template page.llms, then a URL redirect /llms.txt -> /pages/llms (Online Store > Navigation > URL redirects)."));
  // IndexNow
  if (!key) checks.push(check("bing", "indexnow-key", "fail", "No IndexNow key for this store", "", `Set ${STORES[store].prefix}_INDEXNOW_KEY in the console (npx wrangler secret put ${STORES[store].prefix}_INDEXNOW_KEY) and the same key in Site settings below.`));
  else if (keyFile && keyFile.status === 200 && keyFile.body.includes(key))
    checks.push(check("bing", "indexnow-key", "pass", "IndexNow key is verified on the site", indexNowKeyLocation(site, key)));
  else checks.push(check("bing", "indexnow-key", "fail", "The site doesn't serve this store's IndexNow key", indexNowKeyLocation(site, key),
    `Put the same key in Site settings below (IndexNow key), keep page handle indexnow-key (template page.indexnow) and the redirect /${key}.txt -> /pages/indexnow-key.`));

  return { store, site, checkedAt: clock().toISOString(), scores: scoreChecks(checks), checks, pages, sitemapCount: sm.urls.length };
}
const snippet = (p) => ({ title: p.title, description: p.description, canonical: p.canonical, types: p.ldTypes });

// ---------- history (Workers KV, one key per store) ----------
const HISTORY_DAYS = 120;
export async function saveHistory(kv, audit) {
  if (!kv) return null;
  const key = `history:${audit.store}`;
  const list = (await kv.get(key, "json").catch(() => null)) ?? [];
  const date = audit.checkedAt.slice(0, 10);
  const entry = { date, at: audit.checkedAt, scores: audit.scores,
    fails: audit.checks.filter((c) => c.level === "fail").map((c) => c.id), warns: audit.checks.filter((c) => c.level === "warn").map((c) => c.id) };
  const kept = list.filter((e) => e.date !== date);
  const prev = kept.at(-1) ?? null;
  const next = [...kept, entry].slice(-HISTORY_DAYS);
  await kv.put(key, JSON.stringify(next));
  return { history: next, previous: prev };
}
export async function readHistory(kv, store) {
  if (!kv) return [];
  return (await kv.get(`history:${store}`, "json").catch(() => null)) ?? [];
}

// ---------- catalog SEO (Shopify) ----------
export const CATALOG_QUERY = `query MarketingCatalog($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id handle title productType seo { title description } description(truncateAt: 400)
      featuredMedia { id alt preview { image { url } } } }
  }
}`;
export const COLLECTIONS_QUERY = `query MarketingCollections {
  collections(first: 100, sortKey: UPDATED_AT, reverse: true) {
    nodes { id handle title seo { title description } description(truncateAt: 400) image { altText url } }
  }
}`;
const MAX_CATALOG_PAGES = 3;
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const cut = s.slice(0, n - 1); return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 15)).replace(/[\s,;:.-]+$/, "")}…`; };
// A suggested SEO title and description, using the formulas in the SEO toolkit:
// "{name} | {Brand}" (30-60 characters) and "what it is + proof + action" (70-155 characters).
export function suggestSeo(store, item) {
  const brand = BRAND_NAME[store];
  const name = item.title.trim();
  const local = store === "c3d" && !/charleston/i.test(name) ? `${name}, Charleston SC` : name;
  let title = `${local} | ${brand}`;
  if (title.length > 60) title = `${clip(name, 60 - brand.length - 3)} | ${brand}`;
  const base = String(item.description ?? "").replace(/\s+/g, " ").trim();
  const first = base ? (/^(.{40,140}?[.!?])\s/.exec(`${base} `)?.[1] ?? clip(base, 100)) : `${name} from ${brand}.`;
  let description = `${first} ${PITCH[store]}`;
  if (description.length > 155) description = clip(description, 155);
  return { title, description };
}
function seoIssues(store, item, kind, siteName) {
  const issues = [];
  const title = item.seo?.title?.trim() || "";
  const desc = item.seo?.description?.trim() || "";
  const shownTitle = title || `${item.title} – ${siteName}`;
  if (!title) issues.push({ field: "title", level: "warn", text: "No SEO title (search shows the name only)" });
  else if (title.length > 60) issues.push({ field: "title", level: "warn", text: `SEO title is ${title.length} characters, Google cuts it at about 60` });
  else if (title.length < 20) issues.push({ field: "title", level: "warn", text: `SEO title is only ${title.length} characters` });
  if (!desc && !item.description?.trim()) issues.push({ field: "description", level: "fail", text: "No description at all" });
  else if (!desc) issues.push({ field: "description", level: "warn", text: "No SEO description (Google picks text from the page)" });
  else if (desc.length > 160) issues.push({ field: "description", level: "warn", text: `SEO description is ${desc.length} characters, aim for 70 to 160` });
  else if (desc.length < 70) issues.push({ field: "description", level: "warn", text: `SEO description is only ${desc.length} characters` });
  const image = kind === "product" ? item.featuredMedia : item.image;
  if (kind === "product" && !image) issues.push({ field: "image", level: "warn", text: "No photo" });
  else if (image && !(kind === "product" ? image.alt : image.altText)?.trim()) issues.push({ field: "alt", level: "warn", text: "Photo has no alt text" });
  return { shownTitle, issues };
}
export function shapeCatalog(cfg, products, collections) {
  const out = [];
  const add = (kind, n) => {
    const { shownTitle, issues } = seoIssues(cfg.store, n, kind, cfg.name);
    out.push({
      kind, id: n.id, handle: n.handle, title: n.title,
      url: `${cfg.site}/${kind === "product" ? "products" : "collections"}/${encodeURIComponent(n.handle)}`,
      seoTitle: n.seo?.title ?? "", seoDescription: n.seo?.description ?? "", shownTitle,
      image: kind === "product" ? n.featuredMedia?.preview?.image?.url ?? null : n.image?.url ?? null,
      mediaId: kind === "product" ? n.featuredMedia?.id ?? null : null,
      alt: kind === "product" ? n.featuredMedia?.alt ?? "" : n.image?.altText ?? "",
      issues, suggestion: suggestSeo(cfg.store, n),
    });
  };
  products.forEach((p) => add("product", p));
  collections.filter((c) => c.handle !== "frontpage").forEach((c) => add("collection", c));
  // Two pages with the same title compete with each other in search.
  const seen = new Map();
  for (const i of out) { const k = (i.seoTitle || i.title).trim().toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1); }
  for (const i of out) if (seen.get((i.seoTitle || i.title).trim().toLowerCase()) > 1) i.issues.push({ field: "title", level: "warn", text: "Same title as another page" });
  const withIssues = out.filter((i) => i.issues.length).length;
  return { items: out, summary: { total: out.length, withIssues, ok: out.length - withIssues,
    noSeoTitle: out.filter((i) => !i.seoTitle.trim()).length, noSeoDescription: out.filter((i) => !i.seoDescription.trim()).length,
    noAlt: out.filter((i) => i.issues.some((x) => x.field === "alt")).length } };
}
async function loadCatalog(client) {
  const products = [];
  let cursor = null, pages = 0, truncated = false;
  do {
    const d = await client.gql(CATALOG_QUERY, { cursor });
    products.push(...d.products.nodes);
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    if (cursor && ++pages >= MAX_CATALOG_PAGES) { truncated = true; cursor = null; }
  } while (cursor);
  const c = await client.gql(COLLECTIONS_QUERY);
  return { ...shapeCatalog(client.cfg, products, c.collections.nodes), truncated };
}

export const PRODUCT_SEO_MUTATION = `mutation MarketingProductSeo($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id handle seo { title description } } userErrors { field message } }
}`;
export const COLLECTION_SEO_MUTATION = `mutation MarketingCollectionSeo($input: CollectionInput!) {
  collectionUpdate(input: $input) { collection { id handle seo { title description } } userErrors { field message } }
}`;
export const ALT_MUTATION = `mutation MarketingAlt($files: [FileUpdateInput!]!) {
  fileUpdate(files: $files) { files { id alt } userErrors { field message } }
}`;

// ---------- theme settings (Search and AI, Location, Analytics) ----------
// Only these keys of the live theme's config/settings_data.json are read or written. Both themes
// (Charleston 3D and Elevated Designs) have the same ids in their settings_schema.json.
const lines = (max, each, test) => (v) => {
  const list = String(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (list.length > max) return `at most ${max} lines`;
  const bad = list.find((s) => s.length > each || (test && !test(s)));
  return bad ? `"${bad.slice(0, 60)}" isn't allowed` : null;
};
const STREET = /\b\d{2,6}\s+[A-Za-z0-9.' ]{2,40}\s(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway)\b/i;
const PHONE = /(?:\+1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const noPrivate = (v) => (STREET.test(v) || PHONE.test(v) ? "looks like a street address or phone number; the stores show the city only" : null);
const fmt = (re, msg) => (v) => (v === "" || re.test(v) ? null : msg);
export const SETTINGS = {
  home_title: { label: "Homepage title for search results", group: "search", max: 70, check: noPrivate },
  brand_description: { label: "Description (default meta description)", group: "search", max: 320, multiline: true, check: noPrivate },
  tagline: { label: "Tagline", group: "search", max: 120, check: noPrivate },
  google_verification: { label: "Google site verification code", group: "search", max: 100, check: fmt(/^[A-Za-z0-9_-]{10,100}$/, "should be only the content value of the meta tag") },
  bing_verification: { label: "Bing (msvalidate.01) code", group: "search", max: 64, check: fmt(/^[A-Fa-f0-9]{32}$/, "should be the 32-character code from Bing Webmaster Tools") },
  indexnow_key: { label: "IndexNow key", group: "search", max: 128, check: fmt(/^[a-zA-Z0-9-]{8,128}$/, "should be 8 to 128 letters, digits or dashes") },
  same_as: { label: "Profile links (sameAs), one per line", group: "search", max: 2000, multiline: true, check: lines(15, 200, (s) => /^https:\/\/[^\s]+$/.test(s)) },
  city: { label: "City", group: "geo", max: 60, check: noPrivate },
  region: { label: "State code", group: "geo", max: 3, check: fmt(/^[A-Z]{2,3}$/, "should be a state code like SC") },
  geo_lat: { label: "Latitude (city centre)", group: "geo", max: 12, check: fmt(/^-?\d{1,2}(\.\d{1,6})?$/, "should be a number like 32.7765") },
  geo_lng: { label: "Longitude (city centre)", group: "geo", max: 12, check: fmt(/^-?\d{1,3}(\.\d{1,6})?$/, "should be a number like -79.9311") },
  areas_served: { label: "Areas served, one per line", group: "geo", max: 1200, multiline: true, check: (v) => lines(25, 60, (s) => !noPrivate(s))(v) },
  price_range: { label: "Price range", group: "geo", max: 30, check: fmt(/^[$€£0-9 .,–-]{1,30}$/, "should look like $6-$90") },
  ga4_id: { label: "Google Analytics 4 measurement ID", group: "analytics", max: 20, check: fmt(/^G-[A-Z0-9]{4,15}$/, "should look like G-ABC123XYZ") },
  clarity_id: { label: "Microsoft Clarity project ID", group: "analytics", max: 20, check: fmt(/^[a-z0-9]{6,20}$/, "should be the short project ID from Clarity, like k2abc3defg") },
};
export const THEME_QUERY = `query MarketingTheme {
  themes(first: 1, roles: [MAIN]) {
    nodes { id name files(filenames: ["config/settings_data.json"], first: 1) {
      nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } }
  }
}`;
export const THEME_WRITE_MUTATION = `mutation MarketingThemeWrite($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { field message } }
}`;
// settings_data.json can start with a /* ... */ comment that Shopify adds; it is kept as it is.
export function parseSettingsData(text) {
  const m = /^\s*\/\*[\s\S]*?\*\/\s*/.exec(text);
  const header = m ? m[0] : "";
  let data;
  try { data = JSON.parse(text.slice(header.length)); } catch { throw new HttpError(502, "bad_theme", "The live theme's settings_data.json couldn't be read."); }
  if (!data || typeof data !== "object") throw new HttpError(502, "bad_theme", "The live theme's settings_data.json couldn't be read.");
  // "current" is either a preset name (a theme nobody has edited yet) or the settings themselves.
  const current = typeof data.current === "string" ? { ...(data.presets?.[data.current] ?? {}) } : { ...(data.current ?? {}) };
  return { header, data, current };
}
export function pickSettings(current) {
  return Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, current[k] == null ? "" : String(current[k])]));
}
export function validateSettings(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new HttpError(400, "bad_input", "values must be an object of settings.");
  const out = {}, errors = [];
  for (const [k, raw] of Object.entries(values)) {
    const def = SETTINGS[k];
    if (!def) { errors.push(`${k} isn't a setting the console can change`); continue; }
    if (typeof raw !== "string") { errors.push(`${def.label} must be text`); continue; }
    const v = def.multiline ? raw.replace(/\r\n/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean).join("\n") : raw.trim();
    if (v.length > def.max) { errors.push(`${def.label} is longer than ${def.max} characters`); continue; }
    if (/[<>{}]/.test(v)) { errors.push(`${def.label} can't contain < > { or }`); continue; }
    const why = v ? def.check?.(v) : null;
    if (why) { errors.push(`${def.label} ${why}`); continue; }
    out[k] = v;
  }
  if (errors.length) throw new HttpError(400, "bad_input", errors.join(". ").slice(0, 600), { details: { errors } });
  if (!Object.keys(out).length) throw new HttpError(400, "bad_input", "Nothing to change.");
  return out;
}
async function readTheme(client) {
  const d = await client.gql(THEME_QUERY);
  const theme = d?.themes?.nodes?.[0];
  if (!theme) throw new HttpError(404, "no_theme", `${client.cfg.name} has no published theme.`);
  const content = theme.files?.nodes?.[0]?.body?.content;
  if (typeof content !== "string") throw new HttpError(502, "bad_theme", "The live theme has no config/settings_data.json the console can read.");
  return { theme, ...parseSettingsData(content) };
}
export async function writeSettings(client, values) {
  const { theme, header, data, current } = await readTheme(client);
  const before = pickSettings(current);
  const next = { ...current, ...values };
  const body = `${header}${JSON.stringify({ ...data, current: next }, null, 2)}\n`;
  const r = await client.gql(THEME_WRITE_MUTATION, { themeId: theme.id, files: [{ filename: "config/settings_data.json", body: { type: "TEXT", value: body } }] });
  userErrorsOrThrow(r.themeFilesUpsert, "Couldn't save the theme settings");
  const changed = Object.keys(values).filter((k) => before[k] !== values[k]);
  return { theme: { id: theme.id, name: theme.name }, settings: pickSettings(next), changed };
}

// ---------- traffic ----------
export const TRAFFIC_QUERY = `query MarketingTraffic($q: String!) {
  shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType } rows } }
}`;
const qlRows = (t) => {
  const cols = (t?.columns ?? []).map((c) => c.name);
  return (Array.isArray(t?.rows) ? t.rows : []).map((r) => (Array.isArray(r) ? Object.fromEntries(cols.map((c, i) => [c, r[i]])) : r));
};
const pct = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10000) / 100);
export function shapeSources(rows) {
  return rows.map((r) => ({ source: r.referrer_source || "unknown", name: r.referrer_name || "", sessions: Number(r.sessions) || 0, conversionRate: pct(r.conversion_rate) }))
    .filter((r) => r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
}
export function shapeCampaigns(rows) {
  return rows.filter((r) => r.utm_campaign || r.utm_source || r.utm_medium)
    .map((r) => ({ campaign: r.utm_campaign || "(none)", source: r.utm_source || "", medium: r.utm_medium || "", sessions: Number(r.sessions) || 0, conversionRate: pct(r.conversion_rate) }))
    .sort((a, b) => b.sessions - a.sessions);
}
async function shopTraffic(client, days) {
  const run = async (q) => {
    const d = await client.gql(TRAFFIC_QUERY, { q });
    if (!d?.shopifyqlQuery || d.shopifyqlQuery.parseErrors?.length) throw new HttpError(502, "shopify_error", "Shopify couldn't run the traffic report.");
    return qlRows(d.shopifyqlQuery.tableData);
  };
  try {
    const [src, utm] = await Promise.all([
      run(`FROM sessions SHOW sessions, conversion_rate GROUP BY referrer_source, referrer_name SINCE -${days}d UNTIL today ORDER BY sessions DESC LIMIT 25`),
      run(`FROM sessions SHOW sessions, conversion_rate GROUP BY utm_source, utm_medium, utm_campaign SINCE -${days}d UNTIL today ORDER BY sessions DESC LIMIT 50`),
    ]);
    return { available: true, sources: shapeSources(src), campaigns: shapeCampaigns(utm) };
  } catch (e) {
    if (e.code === "access_denied") return { available: false, note: "Add the read_reports scope to this store's app to see visits by source and UTM campaign." };
    if (e.code === "shopify_error") return { available: false, note: "Shopify couldn't run the traffic report for this store (sessions reports need the Online Store)." };
    throw e;
  }
}

// Bing Webmaster Tools API (one API key for the account; each store is its own site in it).
// GetQueryStats returns weekly rows per query: Query, Clicks, Impressions, AvgImpressionPosition, Date.
export async function bingQueries(fetchImpl, env, site) {
  const key = (env("BING_WEBMASTER_API_KEY") ?? "").trim();
  if (!key) return { connected: false, note: "Add BING_WEBMASTER_API_KEY to see Bing search queries (Bing Webmaster Tools > Settings > API access)." };
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(`${site}/`)}&apikey=${encodeURIComponent(key)}`;
  let res;
  try { res = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } }, PAGE_TIMEOUT_MS); }
  catch { return { connected: true, error: "Bing Webmaster Tools didn't answer." }; }
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.d))
    return { connected: true, error: res.status === 401 || res.status === 403 ? "Bing refused BING_WEBMASTER_API_KEY." : `Bing answered ${res.status}. Is ${site} added and verified in Bing Webmaster Tools?` };
  return { connected: true, ...summarizeQueries(body.d.map((r) => ({ query: r.Query, clicks: Number(r.Clicks) || 0, impressions: Number(r.Impressions) || 0, position: Number(r.AvgImpressionPosition) || null }))) };
}
export function summarizeQueries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.query) continue;
    const m = map.get(r.query) ?? { query: r.query, clicks: 0, impressions: 0, posSum: 0 };
    m.clicks += r.clicks; m.impressions += r.impressions; m.posSum += (r.position ?? 0) * r.impressions;
    map.set(r.query, m);
  }
  const queries = [...map.values()].map((m) => ({ query: m.query, clicks: m.clicks, impressions: m.impressions, position: m.impressions ? Math.round((m.posSum / m.impressions) * 10) / 10 : null }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
  return { clicks: queries.reduce((a, q) => a + q.clicks, 0), impressions: queries.reduce((a, q) => a + q.impressions, 0), queries: queries.slice(0, 25),
    // Queries on page 1-2 with impressions but few clicks: improve those pages first.
    opportunities: queries.filter((q) => q.position && q.position >= 4 && q.position <= 20 && q.impressions >= 10).slice(0, 10) };
}

// Google Search Console API with a service account (GSC_SERVICE_ACCOUNT holds its JSON key; add its
// client_email as a user on each property). Property: <PREFIX>_GSC_PROPERTY or sc-domain:<host>.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));
let googleToken = null; // { token, expires, email }
export const clearGoogleToken = () => { googleToken = null; };
async function googleAccessToken(fetchImpl, sa, now) {
  if (googleToken && googleToken.email === sa.client_email && googleToken.expires > now) return googleToken.token;
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const keyObj = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyObj, new TextEncoder().encode(unsigned));
  const res = await fetchWithTimeout(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }).toString(),
  }, PAGE_TIMEOUT_MS);
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string") throw new HttpError(502, "google_auth", "Google refused GSC_SERVICE_ACCOUNT. Check the JSON key.");
  googleToken = { token: body.access_token, email: sa.client_email, expires: now + (Math.max(120, Number(body.expires_in) || 3600) - 60) * 1000 };
  return googleToken.token;
}
export async function googleQueries(fetchImpl, env, store, site, now = Date.now()) {
  const raw = (env("GSC_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw) return { connected: false, note: "Add GSC_SERVICE_ACCOUNT to see Google search queries here (see the README, Marketing)." };
  let sa;
  try { sa = JSON.parse(raw); } catch { return { connected: true, error: "GSC_SERVICE_ACCOUNT isn't valid JSON. Paste the whole key file." }; }
  if (!sa?.client_email || !sa?.private_key) return { connected: true, error: "GSC_SERVICE_ACCOUNT needs client_email and private_key." };
  const property = (env(`${STORES[store].prefix}_GSC_PROPERTY`) ?? "").trim() || `sc-domain:${new URL(site).host.replace(/^www\./, "")}`;
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const end = new Date(now - 2 * 86400000).toISOString().slice(0, 10); // Search Console runs about 2 days behind
    const start = new Date(now - 29 * 86400000).toISOString().slice(0, 10);
    const res = await fetchWithTimeout(fetchImpl, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 250 }),
    }, PAGE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { connected: true, property, error: res.status === 403 ? `Add ${sa.client_email} as a user on ${property} in Google Search Console.` : `Google answered ${res.status}.` };
    const rows = (body?.rows ?? []).map((r) => ({ query: r.keys?.[0] ?? "", clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, position: Number(r.position) || null }));
    return { connected: true, property, start, end, ...summarizeQueries(rows) };
  } catch (e) {
    if (e instanceof HttpError) return { connected: true, property, error: e.message };
    return { connected: true, property, error: e?.name === "AbortError" ? "Google didn't answer in time." : "Couldn't read Google Search Console." };
  }
}

// ---------- input ----------
const GID = { product: /^gid:\/\/shopify\/Product\/[1-9]\d{0,19}$/, collection: /^gid:\/\/shopify\/Collection\/[1-9]\d{0,19}$/, media: /^gid:\/\/shopify\/MediaImage\/[1-9]\d{0,19}$/ };
const only = (body, allowed) => {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(400, "bad_input", `Unexpected field: ${extra.slice(0, 3).join(", ")}.`);
};
const text = (v, name, max) => {
  if (typeof v !== "string") throw new HttpError(400, "bad_input", `${name} must be text.`);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) throw new HttpError(400, "bad_input", `${name} can be at most ${max} characters.`);
  if (/[<>]/.test(s)) throw new HttpError(400, "bad_input", `${name} can't contain < or >.`);
  return s;
};
export function parseMarketingInput(body) {
  const store = parseStore(body.store);
  switch (body.action) {
    case "seo": {
      only(body, ["store", "action", "id", "seoTitle", "seoDescription"]);
      const kind = GID.product.test(body.id) ? "product" : GID.collection.test(body.id) ? "collection" : null;
      if (!kind) throw new HttpError(400, "bad_input", "id must be a product or collection id.");
      return { store, action: "seo", kind, id: body.id, seoTitle: text(body.seoTitle, "seoTitle", 70), seoDescription: text(body.seoDescription, "seoDescription", 320) };
    }
    case "alt": {
      only(body, ["store", "action", "mediaId", "alt"]);
      if (!GID.media.test(body.mediaId)) throw new HttpError(400, "bad_input", "mediaId must be a MediaImage id.");
      return { store, action: "alt", mediaId: body.mediaId, alt: text(body.alt, "alt", 250) };
    }
    case "settings":
      only(body, ["store", "action", "values"]);
      return { store, action: "settings", values: validateSettings(body.values) };
    case "indexnow": {
      only(body, ["store", "action", "urls"]);
      if (body.urls == null) return { store, action: "indexnow", urls: null };
      if (!Array.isArray(body.urls) || !body.urls.length || body.urls.length > 100 || !body.urls.every((u) => typeof u === "string" && u.length < 2000))
        throw new HttpError(400, "bad_input", "urls must be a list of 1 to 100 addresses (or left out to send the whole sitemap).");
      return { store, action: "indexnow", urls: body.urls };
    }
    default:
      throw new HttpError(400, "bad_input", "action must be seo, alt, settings or indexnow.");
  }
}

// ---------- the scheduled daily check (worker cron) ----------
export async function runScheduledAudits(env, fetchImpl, kv, clock = () => new Date()) {
  const out = {};
  for (const store of Object.keys(STORES)) {
    try {
      const site = siteUrl(env, store);
      const audit = await auditSite(fetchImpl, { store, site, key: indexNowKey(env, store), clock });
      await saveHistory(kv, audit);
      out[store] = audit.scores.overall;
    } catch { out[store] = null; }
  }
  return out;
}

// ---------- /api/marketing ----------
const PARTS = new Set(["audit", "catalog", "settings", "traffic", "history"]);
export async function handleMarketing(req, ctx) {
  try {
    const clock = ctx.now ?? (() => new Date());
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Marketing checks");
      const store = parseStore(req.query.get("store"));
      const part = req.query.get("part") ?? "audit";
      if (!PARTS.has(part)) throw new HttpError(400, "bad_input", "part must be audit, catalog, settings, traffic or history.");
      if (part === "audit") {
        const site = siteUrl(ctx.env, store);
        const key = indexNowKey(ctx.env, store);
        const audit = await auditSite(ctx.fetch, { store, site, key, clock });
        const saved = await saveHistory(ctx.kv, audit).catch(() => null);
        const previous = saved?.previous ?? null;
        const newProblems = previous ? audit.checks.filter((c) => c.level === "fail" && !previous.fails.includes(c.id)).map((c) => c.id) : [];
        const fixed = previous ? previous.fails.filter((id) => audit.checks.some((c) => c.id === id && c.level === "pass")) : [];
        return ok({ ...audit, indexNow: { key: Boolean(key), own: Boolean((ctx.env(`${STORES[store].prefix}_INDEXNOW_KEY`) ?? "").trim()) },
          history: saved?.history ?? [], previous, newProblems, fixed, historyAvailable: Boolean(ctx.kv) });
      }
      if (part === "history") return ok({ store, history: await readHistory(ctx.kv, store), historyAvailable: Boolean(ctx.kv) });
      const cfg = storeConfig(ctx.env, store);
      const client = adminClient(cfg, ctx.fetch);
      if (part === "catalog") {
        try { return ok({ store, site: cfg.site, ...(await loadCatalog(client)) }); }
        catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_products scope to see product SEO.", { details: { scopes: ["read_products"] } }); throw e; }
      }
      if (part === "settings") {
        try {
          const { theme, current } = await readTheme(client);
          return ok({ store, theme: { id: theme.id, name: theme.name }, settings: pickSettings(current), fields: SETTINGS });
        } catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_themes and write_themes scopes to see and change these settings.", { details: { scopes: ["read_themes", "write_themes"] } }); throw e; }
      }
      // traffic
      const days = 90;
      const [shop, bing, google] = await Promise.all([shopTraffic(client, days), bingQueries(ctx.fetch, ctx.env, cfg.site), googleQueries(ctx.fetch, ctx.env, store, cfg.site, clock().getTime())]);
      return ok({ store, site: cfg.site, days, shop, bing, google });
    }
    if (req.method === "POST") {
      requireKey(req, ctx.env);
      const input = parseMarketingInput(await readJsonBody(req, 16 * 1024));
      if (input.action === "indexnow") {
        const site = siteUrl(ctx.env, input.store);
        const host = new URL(site).host;
        let urls = input.urls;
        if (urls) {
          if (!urls.every((u) => { try { const x = new URL(u); return x.protocol === "https:" && x.host === host; } catch { return false; } }))
            throw new HttpError(400, "bad_input", `Every address must be on ${host}.`);
        } else urls = (await sitemapUrls(ctx.fetch, site)).urls;
        if (!urls.length) throw new HttpError(409, "nothing_to_send", `The sitemap has no pages on ${host} yet. If ${host} redirects to another domain, make it the primary domain in Shopify first.`);
        const res = await pingIndexNow(ctx.fetch, ctx.env, { store: input.store, prefix: STORES[input.store].prefix, site }, urls);
        if (!res.sent) throw new HttpError(502, "indexnow_failed", res.reason ? `Not sent: ${res.reason}.` : `IndexNow answered ${res.status}. Check the key is verified on the site.`);
        return ok({ store: input.store, indexNow: res });
      }
      const cfg = storeConfig(ctx.env, input.store);
      const client = adminClient(cfg, ctx.fetch);
      if (input.action === "seo") {
        const seo = { title: input.seoTitle, description: input.seoDescription };
        const r = input.kind === "product"
          ? (await client.gql(PRODUCT_SEO_MUTATION, { product: { id: input.id, seo } })).productUpdate
          : (await client.gql(COLLECTION_SEO_MUTATION, { input: { id: input.id, seo } })).collectionUpdate;
        userErrorsOrThrow(r, "Couldn't save the SEO title and description");
        const node = r.product ?? r.collection;
        const url = `${cfg.site}/${input.kind === "product" ? "products" : "collections"}/${encodeURIComponent(node.handle)}`;
        const indexNow = await pingIndexNow(ctx.fetch, ctx.env, cfg, [url]);
        return ok({ store: input.store, id: node.id, seoTitle: node.seo?.title ?? "", seoDescription: node.seo?.description ?? "", url, indexNow });
      }
      if (input.action === "alt") {
        let r;
        try { r = (await client.gql(ALT_MUTATION, { files: [{ id: input.mediaId, alt: input.alt }] })).fileUpdate; }
        catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the write_files scope to save alt text.", { details: { scopes: ["write_files"] } }); throw e; }
        userErrorsOrThrow(r, "Couldn't save the alt text");
        return ok({ store: input.store, mediaId: input.mediaId, alt: r.files?.[0]?.alt ?? input.alt });
      }
      try {
        const saved = await writeSettings(client, input.values);
        return ok({ store: input.store, ...saved });
      } catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_themes and write_themes scopes to change these settings.", { details: { scopes: ["read_themes", "write_themes"] } }); throw e; }
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
