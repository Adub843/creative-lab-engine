import { BRANDS, STATUS, SERVICES, ROUTES, CLEANUP, TOPOLOGY } from "./data.js";

// ---------- helpers ----------
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && e.append(c instanceof Node ? c : document.createTextNode(c)));
  return e;
};
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
// One live region (in index.html) for every toast: screen readers announce a change to a region
// that's already on the page, not a new node that arrives already filled.
let toastRegion = document.getElementById("toast"), toastTimer = 0;
export const toast = (msg) => {
  toastRegion ??= el("div", { class: "toast", id: "toast", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  if (!toastRegion.isConnected) document.body.append(toastRegion);
  clearTimeout(toastTimer);
  toastRegion.textContent = msg;
  toastRegion.classList.add("show");
  toastTimer = setTimeout(() => { toastRegion.classList.remove("show"); toastRegion.textContent = ""; }, 3200);
};
const pill = (cls, txt) => el("span", { class: `pill ${cls}` }, txt);
const statusPill = (s) => pill(`s-${s.status}`, STATUS[s.status]);
const brandPill = (s) => pill(`b-${s.brand}`, BRANDS[s.brand].name);
const ext = (url) => !url.startsWith("#");
const linkBtn = (l, cls = "btn") =>
  el("a", { class: cls, href: l.url, target: ext(l.url) ? "_blank" : null, rel: ext(l.url) ? "noopener" : null },
    l.label, ext(l.url) ? el("span", { class: "ext", "aria-hidden": "true" }, "↗") : null);
const byId = (id) => SERVICES.find((s) => s.id === id);
const count = (fn) => SERVICES.filter(fn).length;

// ---------- drawer ----------
// A modal <dialog>: the page behind it is inert, Escape closes it, and focus goes back to whatever opened it.
const drawer = document.getElementById("drawer");
let lastFocus = null;
export function openService(s) {
  if (!drawer.open) lastFocus = document.activeElement;
  document.getElementById("d-kind").textContent = s.kind;
  document.getElementById("d-title").textContent = s.name;
  document.getElementById("d-tags").replaceChildren(statusPill(s), brandPill(s));
  const body = document.getElementById("d-body");
  body.replaceChildren(
    el("div", { class: "stack" }, el("span", { class: "eyebrow" }, "What it does"), el("p", {}, s.does)),
    s.source ? el("div", { class: "stack" }, el("span", { class: "eyebrow" }, "Code lives in"), el("p", {}, s.source)) : null,
    s.note ? el("div", { class: "stack" }, el("span", { class: "eyebrow" }, "Heads up"), el("p", {}, s.note)) : null,
    el("div", { class: "links" }, s.links.map((l) =>
      el("a", { href: l.url, target: ext(l.url) ? "_blank" : null, rel: "noopener", onclick: ext(l.url) ? null : closeDrawer },
        l.label, el("span", {}, ext(l.url) ? "↗" : "→")))),
  );
  if (!drawer.open) drawer.showModal();
  drawer.scrollTop = 0;
  document.getElementById("d-close").focus();
}
function closeDrawer() { if (drawer.open) drawer.close(); }
drawer.addEventListener("close", () => { const f = lastFocus; lastFocus = null; if (f?.isConnected) f.focus(); });
document.getElementById("d-close").addEventListener("click", closeDrawer);
// A click on the backdrop lands on the <dialog> itself, outside its box.
drawer.addEventListener("click", (e) => {
  if (e.target !== drawer) return;
  const r = drawer.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDrawer();
});
// Keep Tab inside the drawer (wrap at both ends) rather than letting it reach the browser's own controls.
drawer.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const f = [...drawer.querySelectorAll("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => x.getClientRects().length);
  if (!f.length) return;
  const first = f[0], last = f.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---------- jump palette ----------
const PAGES = [
  { name: "Dashboard", url: "#dashboard", kind: "Page" },
  { name: "Charleston 3D", url: "#c3d", kind: "Page" },
  { name: "Products", url: "#products", kind: "Page" },
  { name: "Insights", url: "#insights", kind: "Page" },
  { name: "Marketing: SEO, Bing, AI search", url: "#marketing", kind: "Page" },
  { name: "Promotions: discounts, gift cards, segments", url: "#promote", kind: "Page" },
  { name: "Elevated Designs", url: "#ed", kind: "Page" },
  { name: "Design Studio", url: "#studio", kind: "Page" },
  { name: "Service Map", url: "#map", kind: "Page" },
];
const pal = document.getElementById("palette");
const palQ = document.getElementById("pal-q");
const palList = document.getElementById("pal-list");
function palItems(q) {
  const all = [...PAGES, ...SERVICES.flatMap((s) => s.links.map((l) => ({ name: `${s.name}: ${l.label}`, url: l.url, kind: BRANDS[s.brand].name })))];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((i) => words.every((w) => i.name.toLowerCase().includes(w))).slice(0, 12);
}
// A combobox: focus stays in the search box, Up/Down move the active result (aria-activedescendant), Enter opens it.
let palActive = 0;
const palOptions = () => [...palList.querySelectorAll('[role="option"]')];
function palPick(n) {
  const opts = palOptions();
  if (!opts.length) { palActive = -1; palQ.removeAttribute("aria-activedescendant"); return; }
  palActive = (n + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === palActive)));
  palQ.setAttribute("aria-activedescendant", opts[palActive].id);
  opts[palActive].scrollIntoView({ block: "nearest" });
}
function drawPal() {
  const items = palItems(palQ.value);
  palList.replaceChildren(...items.map((i, n) => el("li", { role: "option", id: `pal-opt-${n}`, "aria-selected": "false", onpointermove: () => palActive !== n && palPick(n) },
    el("a", { href: i.url, tabindex: "-1", target: ext(i.url) ? "_blank" : null, rel: ext(i.url) ? "noopener" : null, onclick: () => pal.close() },
      el("span", {}, i.name), el("span", { class: "muted" }, ext(i.url) ? `${i.kind} ↗` : i.kind)))));
  if (!items.length) palList.append(el("li", { class: "muted", role: "presentation" }, "Nothing matches."));
  palPick(0);
}
export function openPalette() { palQ.value = ""; drawPal(); pal.showModal(); palQ.focus(); }
palQ.addEventListener("input", drawPal);
palQ.addEventListener("keydown", (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step) { e.preventDefault(); palPick(palActive + step); return; }
  if (e.key === "Enter") { e.preventDefault(); palOptions()[palActive]?.querySelector("a")?.click(); }
});
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === "/" && !typing && !pal.open && !document.querySelector("dialog[open]")) { e.preventDefault(); openPalette(); }
});

// ---------- theme ----------
const themeBtn = document.getElementById("theme");
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && darkQuery.matches);
const applyTheme = (t) => {
  if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  themeBtn.setAttribute("aria-pressed", String(isDark()));
};
applyTheme(store.get("bc-theme", null));
darkQuery.addEventListener?.("change", () => themeBtn.setAttribute("aria-pressed", String(isDark())));
themeBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  applyTheme(next); store.set("bc-theme", next);
});

// ---------- phone nav: five sections in the bar, the rest behind More ----------
const side = document.getElementById("side-nav");
const moreBtn = document.getElementById("nav-more");
const moreLabel = moreBtn.querySelector(".lbl");
function setMore(open, { focus = false } = {}) {
  side.classList.toggle("open", open);
  moreBtn.setAttribute("aria-expanded", String(open));
  moreLabel.textContent = open ? "Close" : "More";
  if (focus) moreBtn.focus();
}
moreBtn.addEventListener("click", () => setMore(!side.classList.contains("open")));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) setMore(false, { focus: true }); });
document.addEventListener("pointerdown", (e) => { if (side.classList.contains("open") && !side.contains(e.target)) setMore(false); });

// ---------- shared widgets ----------
function serviceCards(list) {
  return el("div", { class: "cards" }, list.map((s) =>
    el("button", { class: `card brand-${s.brand}`, type: "button", onclick: () => openService(s) },
      el("h3", {}, s.name), el("div", { class: "tags" }, statusPill(s), brandPill(s)), el("p", {}, s.kind))));
}
function alertsList(list) {
  if (!list.length) return el("p", { class: "muted" }, "Nothing needs you right now.");
  return el("div", {}, list.map((s) => el("div", { class: `alert brand-${s.brand}` },
    el("span", { class: "bar" }),
    el("div", { class: "stack", style: "gap:2px" }, el("strong", {}, s.name), el("p", {}, s.note || s.does)),
    el("button", { class: "btn ghost", type: "button", onclick: () => openService(s) }, "Open"))));
}
function todoWidget(key, seed) {
  let items = store.get(key, seed);
  const box = el("div", { class: "todo" });
  const input = el("input", { class: "field", id: `${key}-new`, placeholder: "Add a task and press Enter", "aria-label": "New task" });
  const save = () => { store.set(key, items); draw(); };
  const add = () => { const t = input.value.trim(); if (!t) return; items.push({ t, d: false }); input.value = ""; save(); };
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());
  function draw() {
    box.replaceChildren(...items.map((it, i) => el("label", { class: it.d ? "done" : "" },
      el("input", { type: "checkbox", checked: it.d, onchange: () => { it.d = !it.d; save(); } }),
      el("span", {}, it.t),
      el("button", { class: "x", type: "button", title: "Remove", "aria-label": `Remove ${it.t}`, onclick: (e) => { e.preventDefault(); items.splice(i, 1); save(); } }, "×"))));
  }
  draw();
  return el("div", { class: "stack" }, box, el("div", { class: "add-row" }, input, el("button", { class: "btn", type: "button", onclick: add }, "Add")),
    el("p", { class: "muted", style: "font-size:12.5px" }, "Saved on this device."));
}
function quickLinks(brand, links) {
  return el("div", { class: `quick brand-${brand}` }, links.map(([label, sub, url]) =>
    el("a", { href: url, target: ext(url) ? "_blank" : null, rel: ext(url) ? "noopener" : null },
      el("span", {}, label, ext(url) ? el("span", { class: "ext", "aria-hidden": "true" }, " ↗") : null), el("small", {}, sub))));
}
async function recentImages(n = 12) {
  const { listImages, imageUrl } = await import("./studio.js");
  const items = (await listImages()).slice(0, n);
  if (!items.length) return el("p", { class: "muted" }, "No images yet. Add them in the Design Studio.");
  return el("div", { class: "thumbs" }, items.map((i) => el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" })));
}

// ---------- pages ----------
const C3D_LINKS = [
  ["Website", "charleston3d.com · Shopify", BRANDS.c3d.site],
  ["Order app", "Shop and custom requests", BRANDS.c3d.app],
  ["Products", "Pick what's on the site and app", "#products/c3d"],
  ["Insights", "Sales, visits, forecast", "#insights/c3d"],
  ["Marketing", "SEO, Bing, AI search", "#marketing/c3d"],
  ["Promotions", "Discounts, gift cards, segments", "#promote/c3d"],
  ["Shopify admin", "Orders and products", BRANDS.c3d.admin.url],
  ["Theme", "Shopify theme editor", `${BRANDS.c3d.site}/admin/themes`],
  ["Order maker", "Print files and order form", "https://hype-chain-maker.netlify.app"],
  ["Nameplates", "Nameplate designer", "https://nameplate-maker.netlify.app"],
  ["File finder", "Find 3D print files", "https://3d-print-file-finder.netlify.app"],
  ["Print trends", "What's selling in 3D prints", "https://print-trends.netlify.app"],
];
const ED_LINKS = [
  ["Website", "elevatedshirts.com · Shopify", BRANDS.ed.site],
  ["Shirt app", "Design your own shirt", BRANDS.ed.app],
  ["Products", "Pick what's on the site", "#products/ed"],
  ["Insights", "Sales, visits, forecast", "#insights/ed"],
  ["Marketing", "SEO, Bing, AI search", "#marketing/ed"],
  ["Promotions", "Discounts, gift cards, segments", "#promote/ed"],
  ["Orders", "Shopify admin", `${BRANDS.ed.site}/admin/orders`],
  ["List a design", "One click to the store", "#products/ed/list"],
  ["Shopify products", "Shopify admin", `${BRANDS.ed.site}/admin/products`],
  ["Add a product", "Shopify admin", `${BRANDS.ed.site}/admin/products/new`],
  ["Designs and listings", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/"],
  ["Launch plan", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/plan"],
  ["Market calendar", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/cal"],
  ["Design a shirt", "Design Studio", "#studio"],
  ["Discounts", "Shopify admin", `${BRANDS.ed.site}/admin/discounts`],
  ["Theme", "Shopify theme editor", `${BRANDS.ed.site}/admin/themes`],
];

// The brand's logo (Aaron's picks, 26 Oct 2026) on its own dark tile, so it reads in both themes.
// WebP first, the PNG for browsers without it; width/height are the file's own size, so the box is
// reserved before it loads.
export const brandPicture = (key, attrs) => el("picture", {},
  el("source", { type: "image/webp", srcset: BRANDS[key].logo.replace(/\.png$/, ".webp") }),
  el("img", { src: BRANDS[key].logo, width: BRANDS[key].logoSize[0], height: BRANDS[key].logoSize[1], ...attrs }));
const brandLogo = (key) => brandPicture(key, { class: `brand-logo logo-${key}`, alt: "" });

function header(eyebrow, title, sub, actions = []) {
  return el("header", { class: "page-head" },
    el("div", { class: "stack" }, el("span", { class: "eyebrow" }, eyebrow), el("h1", {}, title), sub ? el("p", { class: "muted" }, sub) : null),
    el("div", { class: "row" }, actions));
}

function dashboard() {
  const attn = SERVICES.filter((s) => s.status === "attn");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const imgs = el("div", {}, el("p", { class: "muted" }, "Loading images…"));
  recentImages().then((n) => imgs.replaceChildren(n)).catch(() => imgs.replaceChildren(el("p", { class: "muted" }, "Couldn't load images.")));
  return [
    header(today, "Dashboard", ["Both businesses at a glance.", el("span", { class: "kbd-hint" }, " Press / to jump anywhere.")],
      [el("button", { class: "btn", type: "button", onclick: openPalette }, "Jump to…", el("kbd", { class: "kbd-hint", "aria-hidden": "true" }, "/")),
       el("a", { class: "btn primary", href: "#studio" }, "New design")]),
    el("div", { class: "kpis" },
      el("button", { class: "kpi warn", type: "button", onclick: () => go("map", "attn") }, el("b", {}, String(attn.length)), el("span", {}, "need attention")),
      el("button", { class: "kpi", type: "button", onclick: () => go("map", "live") }, el("b", {}, String(count((s) => s.status === "live"))), el("span", {}, "live services")),
      el("button", { class: "kpi", type: "button", onclick: () => go("map", "empty") }, el("b", {}, String(count((s) => s.status === "empty"))), el("span", {}, "never launched")),
      el("button", { class: "kpi bad", type: "button", onclick: () => go("map", "blind") }, el("b", {}, String(count((s) => s.status === "blind"))), el("span", {}, "not connected"))),
    el("div", { class: "grid-2" },
      el("section", { class: "panel brand-c3d brand-band" },
        el("div", { class: "panel-head" }, el("h2", { class: "brand-title" }, brandLogo("c3d"), "Charleston 3D"), el("a", { class: "btn ghost", href: "#c3d" }, "Open")),
        el("p", { class: "muted" }, BRANDS.c3d.tagline), quickLinks("c3d", C3D_LINKS.slice(0, 4))),
      el("section", { class: "panel brand-ed brand-band" },
        el("div", { class: "panel-head" }, el("h2", { class: "brand-title" }, brandLogo("ed"), "Elevated Designs"), el("a", { class: "btn ghost", href: "#ed" }, "Open")),
        el("p", { class: "muted" }, BRANDS.ed.tagline), quickLinks("ed", ED_LINKS.slice(0, 4)))),
    el("div", { class: "grid-2" },
      el("section", { class: "panel" }, el("h2", {}, "Needs you"), alertsList(attn)),
      el("section", { class: "panel" }, el("h2", {}, "Today's tasks"),
        todoWidget("bc-todo", [{ t: "Pick which products are live on each store", d: false }, { t: "Check Insights for both stores", d: false }]))),
    el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Latest images"), el("a", { class: "btn ghost", href: "#studio" }, "Open library")), imgs),
  ];
}

function brandPage(key, links, extra = []) {
  const b = BRANDS[key];
  const mine = SERVICES.filter((s) => s.brand === key);
  return [
    b.logo ? el("div", { class: `brand-hero logo-${key}` }, brandPicture(key, { alt: `${b.name} logo` })) : null,
    header("Business", b.name, b.tagline, [linkBtn(b.admin, "btn"), b.app ? linkBtn({ label: "Open app", url: b.app }, "btn") : null,
      linkBtn({ label: "View live site", url: b.site }, `btn brand brand-${key}`)]),
    el("section", { class: `panel brand-${key} brand-band` }, el("h2", {}, "Quick actions"), quickLinks(key, links)),
    ...extra,
    el("section", { class: "panel" }, el("h2", {}, "Needs attention"), alertsList(mine.filter((s) => s.status === "attn"))),
    el("section", { class: "stack" }, el("h2", {}, `Everything for ${b.name}`), serviceCards(mine)),
  ];
}

function mapPage(initial = "all") {
  const FILTERS = [["all", "All"], ["c3d", "Charleston 3D"], ["ed", "Elevated Designs"], ["other", "Other"], ["attn", "Needs attention"], ["empty", "Never launched"], ["blind", "Not connected"]];
  let f = initial, q = "";
  const grid = el("div");
  const chips = el("div", { class: "toolbar", role: "group", "aria-label": "Filter" });
  const draw = () => {
    chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === f)));
    const order = { attn: 0, blind: 1, live: 2, empty: 3 };
    const list = SERVICES.filter((s) => f === "all" || s.brand === f || s.status === f)
      .filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => order[a.status] - order[b.status]);
    grid.replaceChildren(list.length ? serviceCards(list) : el("p", { class: "muted" }, "Nothing matches."));
  };
  FILTERS.forEach(([k, l]) => chips.append(el("button", { class: "chip", type: "button", "data-k": k, onclick: () => { f = k; draw(); } }, l)));
  const search = el("input", { class: "field", id: "map-q", type: "search", placeholder: "Search", "aria-label": "Search services", style: "max-width:240px", oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  draw();
  return [
    header("Topology", "Service Map", "Where every site, store and tool lives and how they connect. Click anything to open it."),
    topologySection(),
    el("section", { class: "stack" }, el("h2", {}, "How each business is routed"),
      ROUTES.map((r) => el("div", { class: `panel route brand-${r.brand} brand-band` }, el("h3", {}, BRANDS[r.brand].name),
        el("div", { class: "chain" }, r.hops.flatMap(([lab, id], i) => {
          const s = byId(id);
          const hop = el("button", { class: "hop", type: "button", onclick: () => openService(s) }, el("small", {}, lab), el("strong", {}, s.name), el("span", { class: "tags" }, statusPill(s)));
          return i ? [el("span", { class: "arrow", "aria-hidden": "true" }, "→"), hop] : [hop];
        }))))),
    el("section", { class: "stack" }, el("h2", {}, "Every service"), el("div", { class: "toolbar" }, chips, search), grid),
    el("section", { class: "panel" }, el("h2", {}, "Suggested cleanup"), el("p", { class: "muted" }, "Nothing here gets deleted or canceled until you approve it."),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "What"), el("th", {}, "Why"), el("th", {}, "Suggestion"))),
        el("tbody", {}, CLEANUP.map((c) => el("tr", {}, el("td", {}, c.what), el("td", {}, c.why), el("td", {}, c.fix))))))),
  ];
}

// ---------- system topology ----------
// Layer by layer, each node with what it feeds; a "feeds" button jumps to that node and flashes it.
function topologySection() {
  const nodes = new Map(TOPOLOGY.flatMap((l) => l.nodes.map((n) => [n.id, n])));
  const jump = (id) => {
    const t = document.getElementById(`topo-${id}`);
    if (!t) return;
    t.scrollIntoView({ behavior: "smooth", block: "center" });
    t.focus({ preventScroll: true });
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
  };
  const ext = (l) => l.url.startsWith("#") ? el("a", { class: "btn ghost", href: l.url }, l.label)
    : el("a", { class: "btn ghost", href: l.url, target: "_blank", rel: "noopener" }, l.label, el("span", { class: "ext", "aria-hidden": "true" }, "↗"));
  const card = (n) => el("article", { class: `topo-node brand-${n.brand}${n.planned ? " planned" : ""}`, id: `topo-${n.id}`, tabindex: "-1" },
    el("div", { class: "topo-head" }, el("strong", {}, n.name), n.planned ? el("span", { class: "pill b-other" }, "Planned") : null),
    el("span", { class: "muted small" }, n.where),
    el("p", { class: "small" }, n.does),
    n.to.length ? el("div", { class: "topo-to" }, n.to.map(([id, how]) => el("button", { class: "chip", type: "button", onclick: () => jump(id) },
      "→ ", nodes.get(id)?.name ?? id, el("span", { class: "muted" }, ` · ${how}`)))) : null,
    n.links.length ? el("div", { class: "row topo-links" }, n.links.map(ext)) : null);
  return el("section", { class: "stack topology", "aria-labelledby": "topo-h" },
    el("h2", { id: "topo-h" }, "System topology"),
    el("p", { class: "muted" }, "Top to bottom: how a customer reaches each brand, where the money goes, what the console runs, where the code lives, and the home-lab pieces still to come. The two brands never share a store, theme or key."),
    TOPOLOGY.map((l) => el("div", { class: `panel topo-layer${l.planned ? " planned" : ""}` },
      el("h3", {}, l.layer), el("div", { class: "topo-grid" }, l.nodes.map(card)))));
}

async function productsPage() {
  const { renderProducts } = await import("./products.js");
  return [header("Both stores", "Products", "Pick which designs are live on each store's Shopify site. Switching one on makes it active and publishes it to the Online Store, so it shows up right away."), await renderProducts()];
}

async function insightsPage() {
  const { renderInsights } = await import("./insights.js");
  return [header("Both stores", "Insights", "Sales, visits and a 30-day forecast from Shopify, with what to do next."), await renderInsights()];
}

async function marketingPage() {
  const { renderMarketing } = await import("./marketing.js");
  return [header("Both stores, one at a time", "Marketing", "Search, local, Bing and AI-assistant health for each site, checked every morning, with the fixes right here."), await renderMarketing()];
}

async function promotePage() {
  const { renderPromotions } = await import("./promotions.js");
  return [header("Both stores, one at a time", "Promotions", "Shopify's marketing tools for each store: discounts, gift cards, customer groups, campaigns, sales channels and abandoned checkouts."), await renderPromotions()];
}

async function studioPage() {
  const { renderStudio } = await import("./studio.js");
  return [header("Elevated Designs", "Design Studio", "Browse your whole image library, drag images onto a shirt, and export a print-ready file."), await renderStudio()];
}

// ---------- router ----------
const view = document.getElementById("view");
let pendingFilter = null;
export function go(route, filter) { pendingFilter = filter ?? null; location.hash = route; }
const TITLES = { dashboard: "Dashboard", c3d: "Charleston 3D", ed: "Elevated Designs", map: "Service Map", studio: "Design Studio", products: "Products", insights: "Insights", marketing: "Marketing", promote: "Promotions" };
// Each render gets a number; a page that finishes after the user has moved on is thrown away.
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = (location.hash.slice(1) || "dashboard").split("/")[0];
  const known = Object.hasOwn(TITLES, route) ? route : "dashboard";
  setMore(false);
  document.querySelectorAll(".nav").forEach((a) => a.dataset.route === known ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.title = `${TITLES[known]} · Business Console`;
  const pages = {
    dashboard,
    c3d: () => brandPage("c3d", C3D_LINKS),
    ed: () => brandPage("ed", ED_LINKS, [el("section", { class: "panel brand-ed" },
      el("div", { class: "panel-head" }, el("h2", {}, "Design Studio"), el("a", { class: "btn brand", href: "#studio" }, "Open studio")),
      el("p", { class: "muted" }, "Your image library and shirt designer. Images are stored online, so you can design from any device."))]),
    map: () => mapPage(pendingFilter ?? "all"),
    studio: studioPage,
    products: productsPage,
    insights: insightsPage,
    marketing: marketingPage,
    promote: promotePage,
  };
  const make = pages[known];
  let nodes, loading = false;
  try {
    nodes = make();
    if (nodes instanceof Promise) {
      // A page that loads its code or data first shows its title straight away.
      loading = true;
      view.setAttribute("aria-busy", "true");
      view.replaceChildren(header("Loading", TITLES[known], "Loading this page…"));
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      nodes = await nodes;
    }
  } catch (err) {
    if (seq !== renderSeq) return;
    console.warn(`The ${TITLES[known]} page didn't load`, err);
    nodes = el("div", { class: "state state-error", role: "alert" },
      el("strong", {}, `The ${TITLES[known]} page didn't load`),
      el("p", {}, "Something went wrong while opening it. Check your connection, then try again. The rest of the console still works."),
      el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: () => render() }, "Try again")));
    nodes = [header("Couldn't open this page", TITLES[known]), nodes];
  }
  if (seq !== renderSeq) return; // the user went somewhere else while this page was loading
  pendingFilter = null;
  view.removeAttribute("aria-busy");
  view.replaceChildren(...[nodes].flat().filter(Boolean));
  if (!loading) window.scrollTo(0, 0);
  // Don't pull focus away from something the user moved to while the page loaded (a dialog, say).
  if (!loading || document.activeElement === document.body || document.activeElement === view) view.focus({ preventScroll: true });
}
addEventListener("hashchange", render);
render();
