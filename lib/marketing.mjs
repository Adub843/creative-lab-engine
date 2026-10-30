// Marketing for each store: monitors, tracks and adjusts SEO, GEO (local and AI search), Bing and
// analytics. Plain functions with no hosting code, like lib/shopify.mjs.
//
//   GET  /api/marketing?store=c3d|ed&part=audit     checks the public site (no Shopify settings needed)
//                                     part=catalog   product and collection SEO, image alt text
//                                     part=settings  the live theme's Search and AI, Location and Analytics settings
//                                     part=traffic   visits by source and UTM campaign, Bing and Google search queries
//                                     part=tracker   rank history, visibility, page movers, ideas, backlinks (lib/tracker.mjs)
//   POST /api/marketing {store, action: "seo" | "alt" | "settings" | "indexnow", ...}
//
// The two brands never share a request: every call names its store, uses that store's own site,
// Shopify, IndexNow key and search properties, and history is kept per store.
import {
  HttpError, STORES, adminClient, fail, fetchWithTimeout, indexNowKey, indexNowKeyLocation, ok, parseStore,
  pingIndexNow, readJsonBody, requireKey, siteUrl, storeConfig, userErrorsOrThrow,
} from "./shopify.mjs";
import { loadTracker, parseTrackerInput, runTrackerAction } from "./tracker.mjs";

const TRACKER_ACTIONS = new Set(["competitors", "compare", "ideas", "links", "snapshot"]);

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
    out.push(p.llmsLink ? check("ai", "llms-link", "pass", "Pages point AI assistants to the llms fact sheet", p.llmsLink)
    : p.llmsLink === "" ? check("ai", "llms-link", "warn", "The llms.txt link on pages has an empty address", url, "The theme's llms link needs href=\"/pages/llms\".")
    : check("ai", "llms-link", "warn", "Pages don't link to the llms fact sheet", "", "The theme adds the link when the llms page exists."));
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
  const [home, robotsRes, llmsRoot, llmsPage, keyFile] = await Promise.all([
    getPage(fetchImpl, `${site}/`),
    getPage(fetchImpl, `${site}/robots.txt`),
    getPage(fetchImpl, `${site}/llms.txt`),
    getPage(fetchImpl, `${site}/pages/llms`),
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
  // llms.txt. Shopify now answers /llms.txt itself with its shopping-agent instructions (UCP,
  // checkout rules), which a redirect can't override, so the brand fact sheet lives at /pages/llms
  // and the theme links there. Shopify's file mentions the shop name, so the brand name alone
  // doesn't prove the facts are ours.
  const brand = STORES[store].name.toLowerCase().replace(/\s+/g, "");
  const isText = (pg) => pg && pg.status === 200 && pg.body.trim().length > 200 && !/<html/i.test(pg.body.slice(0, 500));
  const shopifyAgentFile = (pg) => isText(pg) && /\.well-known\/ucp|universal commerce protocol|web bot auth/i.test(pg.body);
  const brandFacts = (pg) => isText(pg) && !shopifyAgentFile(pg) && pg.body.toLowerCase().replace(/\s+/g, "").includes(brand) && /^#{1,2} /m.test(pg.body);
  const llms = brandFacts(llmsRoot) ? llmsRoot : brandFacts(llmsPage) ? llmsPage : null;
  if (llms)
    checks.push(check("ai", "llms", "pass", `The brand fact sheet for AI assistants is live (${llms.body.length.toLocaleString("en-US")} characters)`, llms.finalUrl));
  else if (shopifyAgentFile(llmsRoot))
    checks.push(check("ai", "llms", "fail", "llms.txt is Shopify's shopping-agent file, and the brand fact sheet isn't live", `${site}/pages/llms`,
      "Shopify serves /llms.txt itself now. Create a page with handle llms and template page.llms (Online Store > Pages); the theme links AI assistants to /pages/llms."));
  else
    checks.push(check("ai", "llms", "fail", llmsRoot.status === 200 ? "llms.txt is empty or isn't plain text" : `llms.txt answered ${llmsRoot.status || llmsRoot.error}`, `${site}/pages/llms`,
      "Create a page with handle llms and template page.llms (Online Store > Pages); the theme links AI assistants to /pages/llms."));
  // IndexNow
  if (!key) checks.push(check("bing", "indexnow-key", "fail", "No IndexNow key for this store", "", "Give this store an IndexNow key in the console's settings (see the setup guide), and put the same key in Site settings below."));
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
  // Long marketplace-style names ("Salt Marsh T-Shirt, Lowcountry Sunset Tee, ...") keep their first part.
  const head = name.split(/\s[-–|]\s|,\s/)[0].trim();
  if (title.length > 60 && head.length >= 8 && `${head} | ${brand}`.length <= 60) title = `${head} | ${brand}`;
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
export const SEO_BEFORE_QUERY = `query MarketingSeoBefore($id: ID!) {
  node(id: $id) {
    ... on Product { title handle seo { title description } featuredMedia { id alt } }
    ... on Collection { title handle seo { title description } }
  }
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
  // Ad pixels: each loads only after the visitor allows marketing cookies (Shopify customerPrivacy).
  meta_pixel_id: { label: "Meta (Facebook and Instagram) pixel ID", group: "analytics", max: 20, check: fmt(/^\d{10,20}$/, "should be the number from Meta Events Manager, like 1234567890123456") },
  tiktok_pixel_id: { label: "TikTok pixel ID", group: "analytics", max: 30, check: fmt(/^[A-Z0-9]{15,30}$/, "should be the pixel code from TikTok Events Manager, like C4ABCDEFGH1234567890") },
  pinterest_tag_id: { label: "Pinterest tag ID", group: "analytics", max: 20, check: fmt(/^\d{10,16}$/, "should be the number from Pinterest Ads, like 2612345678901") },
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
  return { theme: { id: theme.id, name: theme.name }, settings: pickSettings(next), changed,
    before: Object.fromEntries(changed.map((k) => [k, before[k] ?? ""])), after: Object.fromEntries(changed.map((k) => [k, values[k]])) };
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
  if (!key) return { connected: false, note: "Connect Bing Webmaster Tools to see Bing searches here (its API key is under Settings > API access)." };
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(`${site}/`)}&apikey=${encodeURIComponent(key)}`;
  let res;
  try { res = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } }, PAGE_TIMEOUT_MS); }
  catch { return { connected: true, error: "Bing Webmaster Tools didn't answer." }; }
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body?.d))
    return { connected: true, error: res.status === 401 || res.status === 403 ? "Bing didn't accept the Bing Webmaster Tools key. Check it." : `Bing answered ${res.status}. Is ${site} added and verified in Bing Webmaster Tools?` };
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
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyObj, new TextEncoder().encode(unsigned));
  const res = await fetchWithTimeout(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }).toString(),
  }, PAGE_TIMEOUT_MS);
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string") throw new HttpError(502, "google_auth", "Google didn't accept the Google key. Check the key file.");
  googleToken = { token: body.access_token, email: sa.client_email, expires: now + (Math.max(120, Number(body.expires_in) || 3600) - 60) * 1000 };
  return googleToken.token;
}
export async function googleQueries(fetchImpl, env, store, site, now = Date.now()) {
  const raw = (env("GSC_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw) return { connected: false, note: "Connect Google Search Console to see Google searches here (see the setup guide)." };
  let sa;
  try { sa = JSON.parse(raw); } catch { return { connected: true, error: "The Google key isn't a complete key file. Paste the whole file." }; }
  if (!sa?.client_email || !sa?.private_key) return { connected: true, error: "The Google key file is missing its email or private key. Paste the whole file." };
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

// ---------- Google Search Console, in full ----------
// Pages and devices from search results, the sitemaps Google has and their errors, and whether
// Google has indexed a page (URL Inspection). Submitting a sitemap needs the service account to be
// an Owner (or Full user) on the property; reading needs any user.
const gscProperty = (env, store, site) => (env(`${STORES[store].prefix}_GSC_PROPERTY`) ?? "").trim() || `sc-domain:${new URL(site).host.replace(/^www\./, "")}`;
const GSC = "https://searchconsole.googleapis.com";
async function gscCall(fetchImpl, token, method, url, body) {
  const res = await fetchWithTimeout(fetchImpl, url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }, PAGE_TIMEOUT_MS);
  return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
}
const gscDenied = (sa, property, write = false) => `Add ${sa.client_email} as ${write ? "an Owner" : "a user"} on ${property} in Google Search Console.`;
export function shapeInspection(r) {
  const x = r?.inspectionResult?.indexStatusResult ?? {};
  return { verdict: String(x.verdict ?? "VERDICT_UNSPECIFIED").toLowerCase(), coverage: x.coverageState ?? "", lastCrawl: x.lastCrawlTime ?? null,
    googleCanonical: x.googleCanonical ?? null, userCanonical: x.userCanonical ?? null, robots: x.robotsTxtState ?? null, fetch: x.pageFetchState ?? null,
    mobile: r?.inspectionResult?.mobileUsabilityResult?.verdict ?? null, link: r?.inspectionResult?.inspectionResultLink ?? null };
}
export async function googleConsole(fetchImpl, env, store, site, now = Date.now()) {
  const { sa, error } = serviceAccount(env);
  if (!sa) return { connected: Boolean(error), error, note: error ? undefined : "Connect Google Search Console to see your pages, sitemaps and indexing here (see the setup guide)." };
  const property = gscProperty(env, store, site);
  const base = `${GSC}/webmasters/v3/sites/${encodeURIComponent(property)}`;
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const end = dayKey(now - 2 * DAY), start = dayKey(now - 29 * DAY);
    const query = (dimensions, rowLimit) => gscCall(fetchImpl, token, "POST", `${base}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions, rowLimit });
    const [pages, devices, maps, home] = await Promise.all([
      query(["page"], 25), query(["device"], 5), gscCall(fetchImpl, token, "GET", `${base}/sitemaps`),
      gscCall(fetchImpl, token, "POST", `${GSC}/v1/urlInspection/index:inspect`, { inspectionUrl: `${site}/`, siteUrl: property }),
    ]);
    if (pages.status === 403) return { connected: true, property, error: gscDenied(sa, property) };
    if (!pages.ok) return { connected: true, property, error: `Google answered ${pages.status}.` };
    const row = (r) => ({ clicks: n(r.clicks), impressions: n(r.impressions), ctr: Math.round(n(r.ctr) * 1000) / 10, position: r.position ? Math.round(r.position * 10) / 10 : null });
    return {
      connected: true, property, start, end, serviceAccount: sa.client_email,
      pages: (pages.body?.rows ?? []).map((r) => ({ page: r.keys?.[0] ?? "", ...row(r) })),
      devices: devices.ok ? (devices.body?.rows ?? []).map((r) => ({ device: String(r.keys?.[0] ?? "").toLowerCase(), ...row(r) })) : [],
      sitemaps: maps.ok ? (maps.body?.sitemap ?? []).map((m) => ({ path: m.path, submitted: m.lastSubmitted ?? null, downloaded: m.lastDownloaded ?? null, pending: Boolean(m.isPending),
        errors: n(m.errors), warnings: n(m.warnings), urls: (m.contents ?? []).reduce((a, c) => a + n(c.submitted), 0) })) : null,
      home: home.ok ? { url: `${site}/`, ...shapeInspection(home.body) } : { url: `${site}/`, error: home.status === 403 ? gscDenied(sa, property) : `URL Inspection answered ${home.status}.` },
    };
  } catch (e) { return { connected: true, property, error: googleError(e, "Google Search Console") }; }
}
export async function googleAction(fetchImpl, env, input, site, now = Date.now()) {
  const { sa, error } = serviceAccount(env);
  if (!sa) throw new HttpError(503, "not_connected", error ?? "Connect Google Search Console first (see the setup guide).");
  const property = gscProperty(env, input.store, site);
  const token = await googleAccessToken(fetchImpl, sa, now);
  if (input.action === "sitemap") {
    const r = await gscCall(fetchImpl, token, "PUT", `${GSC}/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(`${site}/sitemap.xml`)}`);
    if (r.status === 403) throw new HttpError(502, "google_denied", gscDenied(sa, property, true));
    if (!r.ok) throw new HttpError(502, "google_error", `Google answered ${r.status}.`);
    return { property, submitted: `${site}/sitemap.xml` };
  }
  const r = await gscCall(fetchImpl, token, "POST", `${GSC}/v1/urlInspection/index:inspect`, { inspectionUrl: input.url, siteUrl: property });
  if (r.status === 403) throw new HttpError(502, "google_denied", gscDenied(sa, property));
  if (!r.ok) throw new HttpError(502, "google_error", r.status === 429 ? "Google's daily inspection limit is used up. Try tomorrow." : `Google answered ${r.status}.`);
  return { property, url: input.url, ...shapeInspection(r.body) };
}

// ---------- daily series for the Growth chart ----------
function serviceAccount(env) {
  const raw = (env("GSC_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw) return { error: null };
  try { const sa = JSON.parse(raw); return sa?.client_email && sa?.private_key ? { sa } : { error: "The Google key file is missing its email or private key. Paste the whole file." }; }
  catch { return { error: "The Google key isn't a complete key file. Paste the whole file." }; }
}
const googleError = (e, what) => (e instanceof HttpError ? e.message : e?.name === "AbortError" ? `${what} didn't answer in time.` : `Couldn't read ${what}.`);
// Google Search Console clicks and impressions per day.
export async function googleDaily(fetchImpl, env, store, site, now, days) {
  const { sa, error } = serviceAccount(env);
  if (!sa) return { connected: Boolean(error), error, note: error ? undefined : "Connect Google Search Console to chart Google clicks." };
  const property = (env(`${STORES[store].prefix}_GSC_PROPERTY`) ?? "").trim() || `sc-domain:${new URL(site).host.replace(/^www\./, "")}`;
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const res = await fetchWithTimeout(fetchImpl, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: dayKey(now - days * DAY), endDate: dayKey(now), dimensions: ["date"], rowLimit: 500 }),
    }, PAGE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { connected: true, property, error: res.status === 403 ? `Add ${sa.client_email} as a user on ${property} in Google Search Console.` : `Google answered ${res.status}.` };
    return { connected: true, property, days: Object.fromEntries((body?.rows ?? []).map((r) => [r.keys?.[0], { clicks: n(r.clicks), impressions: n(r.impressions), position: Number(r.position) || null }])) };
  } catch (e) { return { connected: true, property, error: googleError(e, "Google Search Console") }; }
}
// GA4 (optional): engaged time, engagement rate, add-to-carts, purchases, revenue per day.
// <PREFIX>_GA4_PROPERTY is the numeric property id; the service account needs Viewer on it.
export const GA4_METRICS = ["sessions", "averageSessionDuration", "engagementRate", "addToCarts", "ecommercePurchases", "purchaseRevenue"];
export async function ga4Daily(fetchImpl, env, store, now, days) {
  const property = (env(`${STORES[store].prefix}_GA4_PROPERTY`) ?? "").trim();
  if (!property) return { connected: false, note: "Connect Google Analytics to chart time on site and engagement." };
  if (!/^\d{4,15}$/.test(property)) return { connected: true, error: "The Google Analytics property should be the number shown in Admin > Property details, not the G- code." };
  const { sa, error } = serviceAccount(env);
  if (!sa) return { connected: true, error: error ?? "Google Analytics uses the same Google key as Search Console. Connect that first." };
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const res = await fetchWithTimeout(fetchImpl, `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dateRanges: [{ startDate: dayKey(now - days * DAY), endDate: dayKey(now) }], dimensions: [{ name: "date" }], metrics: GA4_METRICS.map((name) => ({ name })), limit: 1000 }),
    }, PAGE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { connected: true, error: res.status === 403 ? `Add ${sa.client_email} as a Viewer on GA4 property ${property}.` : `Google Analytics answered ${res.status}.` };
    const out = {};
    for (const r of body?.rows ?? []) {
      const d = String(r.dimensionValues?.[0]?.value ?? "");
      if (!/^\d{8}$/.test(d)) continue;
      out[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`] = Object.fromEntries(GA4_METRICS.map((m, i) => [m, n(r.metricValues?.[i]?.value)]));
    }
    return { connected: true, property, days: out };
  } catch (e) { return { connected: true, error: googleError(e, "Google Analytics") }; }
}
// Bing clicks and impressions per day (GetRankAndTrafficStats; dates come as /Date(ms-0700)/).
export async function bingDaily(fetchImpl, env, site) {
  const key = (env("BING_WEBMASTER_API_KEY") ?? "").trim();
  if (!key) return { connected: false, note: "Connect Bing Webmaster Tools to chart Bing clicks." };
  try {
    const res = await fetchWithTimeout(fetchImpl, `https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?siteUrl=${encodeURIComponent(`${site}/`)}&apikey=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } }, PAGE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.d)) return { connected: true, error: res.status === 401 || res.status === 403 ? "Bing didn't accept the Bing Webmaster Tools key. Check it." : `Bing answered ${res.status}.` };
    const out = {};
    for (const r of body.d) {
      const ms = Number(/\/Date\((-?\d+)/.exec(String(r.Date))?.[1]);
      if (!Number.isFinite(ms)) continue;
      const k = dayKey(ms);
      out[k] = { clicks: (out[k]?.clicks ?? 0) + n(r.Clicks), impressions: (out[k]?.impressions ?? 0) + n(r.Impressions) };
    }
    return { connected: true, days: out };
  } catch { return { connected: true, error: "Bing Webmaster Tools didn't answer." }; }
}
const sumBy = (series, key, from, to) => series.slice(from, to).reduce((a, d) => a + (d[key] ?? 0), 0);
const pctChange = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
export const GROWTH_METRICS = ["sessions", "visitors", "cartAdds", "checkouts", "orders", "revenue", "duration", "googleClicks", "bingClicks", "health"];
export async function loadGrowth({ env, fetchImpl, kv, store, clock = () => new Date(), days = 90 }) {
  const cfg = storeConfig(env, store);
  const client = adminClient(cfg, fetchImpl);
  const now = clock().getTime();
  let shop = { available: true }, siteRows = [], salesRows = [], pages = new Map();
  try {
    [siteRows, salesRows, pages] = await Promise.all([shopifyql(client, SITE_SESSIONS_Q(days)), shopifyql(client, SITE_SALES_Q(days)), shopifyql(client, PAGE_STATS_Q(days + EFFECT_DAYS)).then(pageDays)]);
  } catch (e) {
    if (e.code === "access_denied") shop = { available: false, note: "Add the read_reports scope to this store's app to chart visits and sales." };
    else if (e.code === "shopify_error") shop = { available: false, note: "Shopify couldn't run the visits report for this store." };
    else throw e;
  }
  const [google, bing, ga4, history, changes] = await Promise.all([
    googleDaily(fetchImpl, env, store, cfg.site, now, days), bingDaily(fetchImpl, env, cfg.site), ga4Daily(fetchImpl, env, store, now, days),
    readHistory(kv, store), readChanges(kv, store),
  ]);
  const site = new Map(siteRows.map((r) => [String(r.day).slice(0, 10), r]));
  const sales = new Map(salesRows.map((r) => [String(r.day).slice(0, 10), r]));
  const health = new Map(history.map((h) => [h.date, h.scores?.overall ?? null]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKey(now - i * DAY);
    const r = site.get(date) ?? {}, sl = sales.get(date) ?? {}, g = google.days?.[date], b = bing.days?.[date], a = ga4.days?.[date];
    series.push({ date, sessions: n(r.sessions), visitors: n(r.online_store_visitors), cartAdds: n(r.sessions_with_cart_additions), checkouts: n(r.sessions_that_reached_checkout),
      orders: n(sl.orders), revenue: Math.round(n(sl.total_sales) * 100) / 100, duration: Math.round(n(r.average_session_duration)), bounce: pct(r.bounce_rate),
      googleClicks: g ? g.clicks : null, googleImpressions: g ? g.impressions : null, bingClicks: b ? b.clicks : null, bingImpressions: b ? b.impressions : null,
      ga4Engagement: a ? Math.round(a.engagementRate * 1000) / 10 : null, ga4EngagedTime: a ? Math.round(a.averageSessionDuration) : null, health: health.get(date) ?? null });
  }
  const siteByDate = new Map(series.map((d) => [d.date, { sessions: d.sessions, cartAdds: d.cartAdds, orders: d.orders }]));
  const totals = {};
  for (const k of ["sessions", "cartAdds", "checkouts", "orders", "revenue", "googleClicks", "bingClicks"]) {
    const last = sumBy(series, k, -30), prev = sumBy(series, k, -60, -30);
    totals[k] = { last30: Math.round(last * 100) / 100, prev30: Math.round(prev * 100) / 100, change: pctChange(last, prev) };
  }
  const withEffect = changes.slice(0, 100).map((c) => ({ ...c, effect: shop.available ? effectFor(c, pages, siteByDate, now) : null }));
  return { store, site: cfg.site, days, series, totals, changes: withEffect, sources: { shop, google: strip(google), bing: strip(bing), ga4: strip(ga4) } };
}
const strip = (x) => { const { days, ...rest } = x; return rest; };

// ---------- keyword tracker ----------
// The phrases each brand wants to be found for, with Google and Bing position, clicks and impressions
// for the last 28 days against the 28 before.
export const DEFAULT_KEYWORDS = {
  c3d: ["3d printing charleston", "custom 3d printed gifts", "personalized ornaments charleston", "3d printed name keychain", "charleston souvenirs"],
  ed: ["charleston graphic tees", "lowcountry t shirts", "custom t shirts charleston", "charleston sweatshirts", "south carolina graphic tees"],
};
const KEYWORD_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&-]{0,78}[\p{L}\p{N}]$/u;
export function parseKeywords(list) {
  if (!Array.isArray(list) || list.length > 30) throw new HttpError(400, "bad_input", "keywords must be a list of up to 30 phrases.");
  const out = [];
  for (const k of list) {
    if (typeof k !== "string") throw new HttpError(400, "bad_input", "Each keyword must be text.");
    const v = k.replace(/\s+/g, " ").trim().toLowerCase();
    if (!KEYWORD_RE.test(v)) throw new HttpError(400, "bad_input", `"${k.slice(0, 40)}" isn't a keyword (2 to 80 letters, numbers, spaces, ' & -).`);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
export async function readKeywords(kv, store) {
  if (!kv) return DEFAULT_KEYWORDS[store];
  try { const v = await kv.get(`keywords:${store}`, { type: "json" }); return Array.isArray(v) ? v : DEFAULT_KEYWORDS[store]; } catch { return DEFAULT_KEYWORDS[store]; }
}
// Search Console rows for any dimensions and dates (the rank tracker uses this; lib/tracker.mjs).
export async function gscRows(fetchImpl, env, store, site, now, { start, end, dimensions, rowLimit = 1000 }) {
  const { sa, error } = serviceAccount(env);
  if (!sa) return { connected: Boolean(error), error };
  const property = gscProperty(env, store, site);
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const r = await gscCall(fetchImpl, token, "POST", `${GSC}/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions, rowLimit });
    if (!r.ok) return { connected: true, error: r.status === 403 ? gscDenied(sa, property) : `Google answered ${r.status}.` };
    return { connected: true, rows: (r.body?.rows ?? []).map((x) => ({ keys: (x.keys ?? []).map(String), clicks: n(x.clicks), impressions: n(x.impressions), position: Number(x.position) || null })) };
  } catch (e) { return { connected: true, error: googleError(e, "Google Search Console") }; }
}
export async function googleKeywordRows(fetchImpl, env, store, site, now, start, end) {
  const { sa, error } = serviceAccount(env);
  if (!sa) return { connected: Boolean(error), error };
  const property = (env(`${STORES[store].prefix}_GSC_PROPERTY`) ?? "").trim() || `sc-domain:${new URL(site).host.replace(/^www\./, "")}`;
  try {
    const token = await googleAccessToken(fetchImpl, sa, now);
    const res = await fetchWithTimeout(fetchImpl, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["query", "page"], rowLimit: 5000 }),
    }, PAGE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { connected: true, error: res.status === 403 ? `Add ${sa.client_email} as a user on ${property} in Google Search Console.` : `Google answered ${res.status}.` };
    return { connected: true, rows: (body?.rows ?? []).map((r) => ({ query: String(r.keys?.[0] ?? "").toLowerCase(), page: r.keys?.[1] ?? "", clicks: n(r.clicks), impressions: n(r.impressions), position: Number(r.position) || null })) };
  } catch (e) { return { connected: true, error: googleError(e, "Google Search Console") }; }
}
// A search counts for a keyword when it contains all of the keyword's words.
const matches = (query, kw) => kw.split(" ").every((w) => query.includes(w));
export function keywordStats(kw, rows) {
  const hit = rows.filter((r) => matches(r.query, kw));
  const clicks = hit.reduce((a, r) => a + r.clicks, 0), impressions = hit.reduce((a, r) => a + r.impressions, 0);
  const position = impressions ? Math.round((hit.reduce((a, r) => a + (r.position ?? 0) * r.impressions, 0) / impressions) * 10) / 10 : null;
  const pages = new Map();
  for (const r of hit) pages.set(r.page, (pages.get(r.page) ?? 0) + r.impressions);
  const page = [...pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { clicks, impressions, position, page, searches: new Set(hit.map((r) => r.query)).size };
}
export async function loadKeywords({ env, fetchImpl, kv, store, clock = () => new Date() }) {
  const site = siteUrl(env, store);
  const now = clock().getTime();
  const keywords = await readKeywords(kv, store);
  const end = dayKey(now - 2 * DAY);
  const [cur, prev, bing] = await Promise.all([
    googleKeywordRows(fetchImpl, env, store, site, now, dayKey(now - 29 * DAY), end),
    googleKeywordRows(fetchImpl, env, store, site, now, dayKey(now - 57 * DAY), dayKey(now - 30 * DAY)),
    bingQueries(fetchImpl, env, site),
  ]);
  const bingRows = (bing.queries ?? []).map((q) => ({ ...q, query: q.query.toLowerCase(), page: "" }));
  return {
    store, keywords: keywords.map((kw) => {
      const g = cur.rows ? keywordStats(kw, cur.rows) : null, gp = prev.rows ? keywordStats(kw, prev.rows) : null;
      return { keyword: kw, google: g, googlePrev: gp, bing: bing.queries ? keywordStats(kw, bingRows) : null,
        moved: g?.position && gp?.position ? Math.round((gp.position - g.position) * 10) / 10 : null };
    }),
    sources: { google: cur.rows ? { connected: true } : { connected: cur.connected, error: cur.error, note: cur.connected ? undefined : "Connect Google Search Console to see Google positions." },
      bing: bing.queries ? { connected: true } : { connected: bing.connected, error: bing.error, note: bing.note } },
  };
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
      only(body, ["store", "action", "mediaId", "alt", "productId"]);
      if (!GID.media.test(body.mediaId)) throw new HttpError(400, "bad_input", "mediaId must be a MediaImage id.");
      if (body.productId != null && !GID.product.test(body.productId)) throw new HttpError(400, "bad_input", "productId must be a product id.");
      return { store, action: "alt", mediaId: body.mediaId, alt: text(body.alt, "alt", 250), productId: body.productId ?? null };
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
    case "autofix":
      only(body, ["store", "action"]);
      return { store, action: "autofix" };
    case "keywords":
      only(body, ["store", "action", "keywords"]);
      return { store, action: "keywords", keywords: parseKeywords(body.keywords) };
    case "sitemap":
      only(body, ["store", "action"]);
      return { store, action: "sitemap" };
    case "inspect":
      only(body, ["store", "action", "url"]);
      if (typeof body.url !== "string" || body.url.length > 2000) throw new HttpError(400, "bad_input", "url must be a page address.");
      return { store, action: "inspect", url: body.url };
    case "undo":
      only(body, ["store", "action", "changeId"]);
      if (typeof body.changeId !== "string" || !/^\d{8,14}-[0-9a-f]{8}$/.test(body.changeId)) throw new HttpError(400, "bad_input", "changeId isn't a change from the log.");
      return { store, action: "undo", changeId: body.changeId };
    default:
      throw new HttpError(400, "bad_input", "action must be seo, alt, settings, indexnow, autofix, keywords, sitemap, inspect, undo, competitors, compare, ideas, links or snapshot.");
  }
}

// ---------- change log ----------
// Every change to a store's marketing (automatic or made on this page) is kept with what it
// replaced, so the Growth chart can show it against visits and sales, and a change that hurt can be
// undone. Newest first, per store, in the MARKETING KV.
const CHANGE_LOG_MAX = 300;
export async function readChanges(kv, store) {
  if (!kv) return [];
  try { const v = await kv.get(`changes:${store}`, { type: "json" }); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function writeChanges(kv, store, list) {
  if (kv) await kv.put(`changes:${store}`, JSON.stringify(list.slice(0, CHANGE_LOG_MAX)));
}
export async function logChanges(kv, store, entries) {
  if (!kv || !entries.length) return;
  await writeChanges(kv, store, [...entries, ...(await readChanges(kv, store))]);
}
const changeId = (at) => `${at.replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
export function changeEntry({ at, source, kind, itemKind = null, target = null, title, url, before, after, note = "" }) {
  return { id: changeId(at), at, source, kind, itemKind, target, title, url, before, after, ...(note ? { note } : {}) };
}

// ---------- page and site stats (ShopifyQL) ----------
const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
async function shopifyql(client, q) {
  const d = await client.gql(TRAFFIC_QUERY, { q });
  if (!d?.shopifyqlQuery || d.shopifyqlQuery.parseErrors?.length) throw new HttpError(502, "shopify_error", "Shopify couldn't run the report.");
  return qlRows(d.shopifyqlQuery.tableData);
}
export const PAGE_STATS_Q = (days) => `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout GROUP BY landing_page_path TIMESERIES day SINCE -${days}d UNTIL today LIMIT 5000`;
export const SITE_SESSIONS_Q = (days) => `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate, average_session_duration, bounce_rate TIMESERIES day SINCE -${days}d UNTIL today`;
export const SITE_SALES_Q = (days) => `FROM sales SHOW orders, total_sales TIMESERIES day SINCE -${days}d UNTIL today`;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// path -> date -> { sessions, cartAdds, orders }
export function pageDays(rows) {
  const out = new Map();
  for (const r of rows) {
    const path = String(r.landing_page_path || "").split("?")[0];
    const date = String(r.day || "").slice(0, 10);
    if (!path || !date) continue;
    const m = out.get(path) ?? new Map();
    const d = m.get(date) ?? { sessions: 0, cartAdds: 0, orders: 0 };
    d.sessions += n(r.sessions); d.cartAdds += n(r.sessions_with_cart_additions); d.orders += n(r.sessions_that_completed_checkout);
    m.set(date, d); out.set(path, m);
  }
  return out;
}
// The 14 days before a change against the days since (up to 14). Per-day rates, so a change only a
// week old still compares fairly. "early" until it has 7 days behind it.
export const EFFECT_DAYS = 14;
export function changeEffect(change, byDate, now) {
  const start = Date.parse(`${change.at.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const sum = (from, days) => {
    const t = { sessions: 0, cartAdds: 0, orders: 0 };
    for (let i = 0; i < days; i++) { const d = byDate?.get(dayKey(from + i * DAY)); if (d) { t.sessions += d.sessions; t.cartAdds += d.cartAdds; t.orders += d.orders; } }
    return t;
  };
  const afterDays = Math.max(0, Math.min(EFFECT_DAYS, Math.round((today - start) / DAY)));
  const before = sum(start - EFFECT_DAYS * DAY, EFFECT_DAYS), after = sum(start, afterDays);
  const perDay = (t, d) => (d ? Math.round((t.sessions / d) * 100) / 100 : null);
  const b = perDay(before, EFFECT_DAYS), a = perDay(after, afterDays);
  return { days: afterDays, early: afterDays < 7, before, after, beforePerDay: b, afterPerDay: a,
    change: b && a != null ? Math.round(((a - b) / b) * 100) : null };
}
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return "/"; } };
// Site-wide changes (theme settings) are measured on the whole site, others on their own page.
function effectFor(change, pages, siteByDate, now) {
  return changeEffect(change, change.kind === "settings" || change.kind === "promotion" ? siteByDate : pages.get(pathOf(change.url)), now);
}

// ---------- automatic fixes ----------
// Aaron's standing rule: fixes the checks find are applied straight away, not just suggested. Only
// safe, reversible ones: an empty or too-long SEO title, an empty, too-long or too-short SEO
// description (replaced by the suggestion, never by something shorter), and empty photo alt text.
// Wording within the limits is never touched. After 14 days each automatic change is reviewed
// against its page's visits: if they fell by 30% or more (on at least one visit a day before), the
// old wording is put back and that page is left alone from then on.
export const AUTOFIX_MAX_CHANGES = 12; // Shopify writes per store per run (the free plan allows 50 subrequests per run)
export const REVERT_DROP = -30;
const REVERT_MIN_PER_DAY = 1;
export function planFixes(store, catalog, max = AUTOFIX_MAX_CHANGES, leaveAlone = new Set()) {
  const plan = [];
  const brand = BRAND_NAME[store];
  const items = [...catalog.items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "product" ? -1 : 1));
  for (const i of items) {
    if (plan.length >= max) break;
    const t = i.seoTitle.trim(), d = i.seoDescription.trim();
    const title = !t || t.length > 60 ? i.suggestion.title : t;
    const description = !d || d.length > 160 || (d.length < 70 && i.suggestion.description.length > d.length) ? i.suggestion.description : d;
    if ((title !== t || description !== d) && !leaveAlone.has(i.id))
      plan.push({ kind: "seo", itemKind: i.kind, target: i.id, title: i.title, url: i.url,
        before: { seoTitle: i.seoTitle, seoDescription: i.seoDescription }, after: { seoTitle: title, seoDescription: description } });
    if (plan.length < max && i.mediaId && !i.alt.trim() && !leaveAlone.has(i.mediaId))
      plan.push({ kind: "alt", itemKind: i.kind, target: i.mediaId, title: i.title, url: i.url, before: { alt: "" }, after: { alt: clip(`${i.title} from ${brand}`, 250) } });
  }
  return plan;
}
async function writeFix(client, f) {
  if (f.kind === "seo") {
    const seo = { title: f.after.seoTitle, description: f.after.seoDescription };
    const r = f.itemKind === "product"
      ? (await client.gql(PRODUCT_SEO_MUTATION, { product: { id: f.target, seo } })).productUpdate
      : (await client.gql(COLLECTION_SEO_MUTATION, { input: { id: f.target, seo } })).collectionUpdate;
    userErrorsOrThrow(r, "Couldn't save the SEO title and description");
  } else userErrorsOrThrow((await client.gql(ALT_MUTATION, { files: [{ id: f.target, alt: f.after.alt }] })).fileUpdate, "Couldn't save the alt text");
}
const currentOf = (catalog, c) => {
  const i = catalog.items.find((x) => (c.kind === "alt" ? x.mediaId : x.id) === c.target);
  if (!i) return null;
  return c.kind === "alt" ? { alt: i.alt } : { seoTitle: i.seoTitle, seoDescription: i.seoDescription };
};
const same = (a, b) => a && b && Object.keys(b).every((k) => String(a[k] ?? "").trim() === String(b[k] ?? "").trim());
export async function applyFixes({ env, fetchImpl, kv, store, clock = () => new Date(), max = AUTOFIX_MAX_CHANGES }) {
  const cfg = storeConfig(env, store);
  const client = adminClient(cfg, fetchImpl);
  const catalog = await loadCatalog(client);
  const now = clock();
  let log = await readChanges(kv, store);
  const applied = [], failed = [], reviewed = [];
  let writes = 0;

  // 1. Review automatic changes that are 14 days old against their page's visits.
  const due = log.filter((c) => c.source === "auto" && (c.kind === "seo" || c.kind === "alt") && !c.review && now - Date.parse(c.at) >= EFFECT_DAYS * DAY);
  if (due.length) {
    let pages = null;
    try { pages = pageDays(await shopifyql(client, PAGE_STATS_Q(EFFECT_DAYS * 2 + 2))); } catch { /* no read_reports: review later */ }
    for (const c of pages ? due : []) {
      const effect = changeEffect(c, pages.get(pathOf(c.url)), now);
      const hurt = effect.change != null && effect.change <= REVERT_DROP && effect.beforePerDay >= REVERT_MIN_PER_DAY;
      let verdict = hurt ? "undo" : "kept";
      if (hurt) {
        // Only undo if nobody has changed it since; otherwise their wording stays.
        if (!same(currentOf(catalog, c), c.after) || writes >= max) verdict = writes >= max ? null : "kept";
        else {
          const undo = { ...c, before: c.after, after: c.before };
          try {
            await writeFix(client, undo); writes++;
            const at = now.toISOString();
            const entry = changeEntry({ at, source: "auto", kind: "revert", itemKind: c.itemKind, target: c.target, title: c.title, url: c.url,
              before: c.after, after: c.before, note: `Visits to this page fell ${Math.abs(effect.change)}% in the 14 days after the change, so the old wording is back.` });
            applied.push(entry);
          } catch (e) { verdict = null; failed.push({ title: c.title, kind: "revert", error: e?.message ?? "failed" }); }
        }
      }
      if (verdict) { c.review = { verdict, at: now.toISOString(), change: effect.change, beforePerDay: effect.beforePerDay, afterPerDay: effect.afterPerDay }; reviewed.push(c.id); }
    }
  }

  // 2. Fix what's missing, leaving alone anything an undo put back.
  const leaveAlone = new Set(log.filter((c) => c.review?.verdict === "undo").map((c) => c.target));
  const plan = planFixes(store, catalog, Math.max(0, max - writes), leaveAlone);
  for (const f of plan) {
    try {
      await writeFix(client, f); writes++;
      applied.push(changeEntry({ at: clock().toISOString(), source: "auto", ...f }));
    } catch (e) {
      failed.push({ title: f.title, kind: f.kind, error: e?.message ?? "failed" });
      if (e?.code === "access_denied") break; // a missing scope fails every write the same way
    }
  }
  if (applied.length || reviewed.length) { log = [...applied.slice().reverse(), ...log]; await writeChanges(kv, store, log); }
  const urls = [...new Set(applied.map((f) => f.url))];
  const indexNow = urls.length ? await pingIndexNow(fetchImpl, env, cfg, urls) : null;
  const remaining = planFixes(store, catalog, Infinity, leaveAlone).length - plan.filter((f) => !failed.some((x) => x.title === f.title && x.kind === f.kind)).length;
  return { store, applied, failed, reviewed: reviewed.length, remaining: Math.max(0, remaining), indexNow };
}
export async function runScheduledFixes(env, fetchImpl, kv, clock = () => new Date()) {
  const out = {};
  if ((env("MARKETING_AUTOFIX") ?? "").trim().toLowerCase() === "off") return out;
  for (const store of Object.keys(STORES)) {
    try { const r = await applyFixes({ env, fetchImpl, kv, store, clock }); out[store] = { applied: r.applied.length, failed: r.failed.length, reviewed: r.reviewed, remaining: r.remaining }; }
    catch (e) { out[store] = { error: e?.code ?? "failed" }; }
  }
  return out;
}

// ---------- Holo (tryholo.ai), the AI marketing agent ----------
// Holo writes blog posts and publishes them straight to each store's Shopify blog with its own
// connector. The console reads that blog's public Atom feed (no extra scopes), lists the posts and
// logs each new one in the change log, so the Growth chart shows what every post did to visits.
// <PREFIX>_HOLO_BLOG names the blog handle Holo publishes to (default "news").
export const HOLO_APP = "https://app.tryholo.ai/";
const holoBlog = (env, store) => ((env(`${STORES[store].prefix}_HOLO_BLOG`) ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "news");
const xmlText = (s) => (s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
export function parseAtom(xml, host) {
  const out = [];
  for (const m of String(xml ?? "").matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const e = m[0];
    const tag = (t) => xmlText((e.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`)) ?? [])[1]);
    const href = (e.match(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/) ?? e.match(/<link\b[^>]*href="([^"]+)"/) ?? [])[1];
    let url;
    try { url = new URL(xmlText(href)); } catch { continue; }
    if (url.protocol !== "https:" || (host && url.host !== host)) continue;
    const title = tag("title").slice(0, 200);
    if (!title) continue;
    out.push({ title, url: url.href, published: tag("published") || null, updated: tag("updated") || null, author: tag("name") || null });
  }
  return out;
}
const isoOr = (v, d) => { const t = Date.parse(v ?? ""); return Number.isFinite(t) ? new Date(t).toISOString() : d; };
export async function loadHolo({ env, fetchImpl, kv, store, clock = () => new Date() }) {
  const site = siteUrl(env, store), host = new URL(site).host, blog = holoBlog(env, store);
  const feed = `${site}/blogs/${blog}.atom`;
  let posts = [], error = null;
  try {
    const res = await fetchWithTimeout(fetchImpl, feed, { headers: { accept: "application/atom+xml" } }, PAGE_TIMEOUT_MS);
    if (res.status === 404) error = `The store has no blog at /blogs/${blog} yet.`;
    else if (!res.ok) error = `The blog feed answered ${res.status}.`;
    else posts = parseAtom(await readCapped(res, 2_000_000), host);
  } catch { error = "Couldn't reach the store's blog."; }
  let logged = 0;
  if (kv && posts.length) {
    const seen = new Set((await readChanges(kv, store)).filter((c) => c.kind === "article").map((c) => c.url));
    const at = clock().toISOString();
    const fresh = posts.filter((p) => !seen.has(p.url)).map((p) => changeEntry({ at: isoOr(p.published, at), source: "blog", kind: "article", title: p.title, url: p.url, before: {}, after: { post: "published" }, note: "New blog post." }));
    if (fresh.length) { await logChanges(kv, store, fresh).catch(() => {}); logged = fresh.length; }
  }
  return { store, site, blog, feed, posts: posts.slice(0, 10), total: posts.length, logged, error, app: HOLO_APP };
}

// ---------- the scheduled daily check (worker cron) ----------
export async function runScheduledAudits(env, fetchImpl, kv, clock = () => new Date()) {
  const out = {};
  for (const store of Object.keys(STORES)) {
    try {
      const site = siteUrl(env, store);
      const audit = await auditSite(fetchImpl, { store, site, key: indexNowKey(env, store), clock });
      await saveHistory(kv, audit);
      await loadHolo({ env, fetchImpl, kv, store, clock }).catch(() => null);
      out[store] = audit.scores.overall;
    } catch { out[store] = null; }
  }
  return out;
}

// ---------- /api/marketing ----------
const PARTS = new Set(["audit", "catalog", "settings", "traffic", "history", "changes", "growth", "keywords", "google", "holo", "tracker"]);
export async function handleMarketing(req, ctx) {
  try {
    const clock = ctx.now ?? (() => new Date());
    if (req.method === "GET") {
      requireKey(req, ctx.env, "Marketing checks");
      const store = parseStore(req.query.get("store"));
      const part = req.query.get("part") ?? "audit";
      if (!PARTS.has(part)) throw new HttpError(400, "bad_input", "part must be audit, catalog, settings, traffic, history, changes, growth, keywords, google, holo or tracker.");
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
      if (part === "changes") return ok({ store, changes: await readChanges(ctx.kv, store), auto: (ctx.env("MARKETING_AUTOFIX") ?? "").trim().toLowerCase() !== "off", logAvailable: Boolean(ctx.kv) });
      if (part === "holo") return ok(await loadHolo({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store, clock }));
      if (part === "google") return ok({ store, ...(await googleConsole(ctx.fetch, ctx.env, store, siteUrl(ctx.env, store), clock().getTime())) });
      if (part === "tracker") return ok(await loadTracker({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store, clock }));
      if (part === "keywords") return ok({ ...(await loadKeywords({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store, clock })), saveAvailable: Boolean(ctx.kv) });
      if (part === "growth") {
        const days = Math.min(180, Math.max(14, Number.parseInt(req.query.get("days") ?? "90", 10) || 90));
        return ok({ ...(await loadGrowth({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store, clock, days })), logAvailable: Boolean(ctx.kv) });
      }
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
      const raw = await readJsonBody(req, 16 * 1024);
      // The rank tracker's own actions (lib/tracker.mjs).
      if (TRACKER_ACTIONS.has(raw.action)) {
        const store = parseStore(raw.store);
        return ok(await runTrackerAction(parseTrackerInput(raw, store, siteUrl(ctx.env, store)), ctx, clock));
      }
      const input = parseMarketingInput(raw);
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
      if (input.action === "autofix") {
        try { return ok(await applyFixes({ env: ctx.env, fetchImpl: ctx.fetch, kv: ctx.kv, store: input.store, clock })); }
        catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_products, write_products and write_files scopes to apply fixes.", { details: { scopes: ["read_products", "write_products", "write_files"] } }); throw e; }
      }
      if (input.action === "sitemap" || input.action === "inspect") {
        const site = siteUrl(ctx.env, input.store);
        if (input.action === "inspect") {
          let u;
          try { u = new URL(input.url); } catch { throw new HttpError(400, "bad_input", "url must be a page address."); }
          if (u.protocol !== "https:" || u.host !== new URL(site).host) throw new HttpError(400, "bad_input", `The page must be on ${new URL(site).host}.`);
        }
        return ok({ store: input.store, ...(await googleAction(ctx.fetch, ctx.env, input, site, clock().getTime())) });
      }
      if (input.action === "keywords") {
        if (!ctx.kv) throw new HttpError(503, "no_storage", "Saving keywords needs the console's storage, which isn't set up yet (see the setup guide).");
        await ctx.kv.put(`keywords:${input.store}`, JSON.stringify(input.keywords));
        return ok({ store: input.store, keywords: input.keywords });
      }
      const cfg = storeConfig(ctx.env, input.store);
      const client = adminClient(cfg, ctx.fetch);
      const at = () => clock().toISOString();
      if (input.action === "undo") {
        const log = await readChanges(ctx.kv, input.store);
        const c = log.find((x) => x.id === input.changeId);
        if (!c) throw new HttpError(404, "not_found", "That change isn't in the log any more.");
        if (c.kind === "seo" || c.kind === "alt" || c.kind === "revert") {
          const kind = c.kind === "revert" ? ("alt" in (c.after ?? {}) ? "alt" : "seo") : c.kind;
          await writeFix(client, { kind, itemKind: c.itemKind, target: c.target, after: c.before });
        } else if (c.kind === "settings") {
          const values = validateSettings(c.before);
          await writeSettings(client, values);
        } else throw new HttpError(400, "bad_input", "This change can't be undone from here.");
        const entry = changeEntry({ at: at(), source: "console", kind: "revert", itemKind: c.itemKind, target: c.target, title: c.title, url: c.url, before: c.after, after: c.before, note: "Undone on the Marketing page." });
        if (c.kind === "settings") entry.kind = "settings";
        c.review = { verdict: "undo", at: entry.at, by: "you" };
        await writeChanges(ctx.kv, input.store, [entry, ...log]);
        if (c.kind !== "settings") await pingIndexNow(ctx.fetch, ctx.env, cfg, [c.url]);
        return ok({ store: input.store, undone: c.id, entry });
      }
      if (input.action === "seo") {
        const prev = (await client.gql(SEO_BEFORE_QUERY, { id: input.id }).catch(() => null))?.node ?? null;
        const seo = { title: input.seoTitle, description: input.seoDescription };
        const r = input.kind === "product"
          ? (await client.gql(PRODUCT_SEO_MUTATION, { product: { id: input.id, seo } })).productUpdate
          : (await client.gql(COLLECTION_SEO_MUTATION, { input: { id: input.id, seo } })).collectionUpdate;
        userErrorsOrThrow(r, "Couldn't save the SEO title and description");
        const node = r.product ?? r.collection;
        const url = `${cfg.site}/${input.kind === "product" ? "products" : "collections"}/${encodeURIComponent(node.handle)}`;
        const indexNow = await pingIndexNow(ctx.fetch, ctx.env, cfg, [url]);
        const before = { seoTitle: prev?.seo?.title ?? "", seoDescription: prev?.seo?.description ?? "" };
        const after = { seoTitle: node.seo?.title ?? "", seoDescription: node.seo?.description ?? "" };
        if (!same(before, after)) await logChanges(ctx.kv, input.store, [changeEntry({ at: at(), source: "console", kind: "seo", itemKind: input.kind, target: node.id, title: prev?.title ?? node.handle, url, before, after })]).catch(() => {});
        return ok({ store: input.store, id: node.id, seoTitle: after.seoTitle, seoDescription: after.seoDescription, url, indexNow });
      }
      if (input.action === "alt") {
        const prod = input.productId ? (await client.gql(SEO_BEFORE_QUERY, { id: input.productId }).catch(() => null))?.node ?? null : null;
        const owner = prod?.featuredMedia?.id === input.mediaId ? prod : null;
        let r;
        try { r = (await client.gql(ALT_MUTATION, { files: [{ id: input.mediaId, alt: input.alt }] })).fileUpdate; }
        catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the write_files scope to save alt text.", { details: { scopes: ["write_files"] } }); throw e; }
        userErrorsOrThrow(r, "Couldn't save the alt text");
        const alt = r.files?.[0]?.alt ?? input.alt;
        if ((owner?.featuredMedia?.alt ?? "") !== alt)
          await logChanges(ctx.kv, input.store, [changeEntry({ at: at(), source: "console", kind: "alt", itemKind: "product", target: input.mediaId,
            title: owner?.title ?? "Photo", url: owner ? `${cfg.site}/products/${encodeURIComponent(owner.handle)}` : `${cfg.site}/`, before: { alt: owner?.featuredMedia?.alt ?? "" }, after: { alt } })]).catch(() => {});
        return ok({ store: input.store, mediaId: input.mediaId, alt });
      }
      try {
        const { before, after, ...saved } = await writeSettings(client, input.values);
        if (saved.changed.length)
          await logChanges(ctx.kv, input.store, [changeEntry({ at: at(), source: "console", kind: "settings", title: `Site settings: ${saved.changed.map((k) => SETTINGS[k].label).join(", ")}`, url: `${cfg.site}/`, before, after })]).catch(() => {});
        return ok({ store: input.store, ...saved });
      } catch (e) { if (e.code === "access_denied") throw new HttpError(502, "access_denied", "Add the read_themes and write_themes scopes to change these settings.", { details: { scopes: ["read_themes", "write_themes"] } }); throw e; }
    }
    throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  } catch (e) {
    return fail(e);
  }
}
