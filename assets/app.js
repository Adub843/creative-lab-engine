import { BRANDS, STATUS, SERVICES, ROUTES, CLEANUP } from "./data.js";

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
export const toast = (msg) => {
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
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
const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
let lastFocus = null;
export function openService(s) {
  lastFocus = document.activeElement;
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
  drawer.hidden = scrim.hidden = false;
  document.getElementById("d-close").focus();
}
function closeDrawer() { drawer.hidden = scrim.hidden = true; lastFocus?.focus(); }
document.getElementById("d-close").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

// ---------- jump palette ----------
const PAGES = [
  { name: "Dashboard", url: "#dashboard", kind: "Page" },
  { name: "Charleston 3D", url: "#c3d", kind: "Page" },
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
function drawPal() {
  const items = palItems(palQ.value);
  palList.replaceChildren(...items.map((i, n) => el("li", { role: "option", "aria-selected": String(n === 0) },
    el("a", { href: i.url, target: ext(i.url) ? "_blank" : null, rel: "noopener", onclick: () => pal.close() },
      el("span", {}, i.name), el("span", { class: "muted" }, i.kind)))));
  if (!items.length) palList.append(el("li", { class: "muted" }, "Nothing matches."));
}
export function openPalette() { palQ.value = ""; drawPal(); pal.showModal(); palQ.focus(); }
palQ.addEventListener("input", drawPal);
palQ.addEventListener("keydown", (e) => { if (e.key === "Enter") palList.querySelector("a")?.click(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !drawer.hidden) closeDrawer();
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !pal.open) { e.preventDefault(); openPalette(); }
});

// ---------- theme ----------
const applyTheme = (t) => (t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme"));
applyTheme(store.get("bc-theme", null));
document.getElementById("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  applyTheme(next); store.set("bc-theme", next);
});

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
      el("button", { class: "x", type: "button", "aria-label": `Remove ${it.t}`, onclick: (e) => { e.preventDefault(); items.splice(i, 1); save(); } }, "×"))));
  }
  draw();
  return el("div", { class: "stack" }, box, el("div", { class: "add-row" }, input, el("button", { class: "btn", type: "button", onclick: add }, "Add")),
    el("p", { class: "muted", style: "font-size:12.5px" }, "Saved on this device."));
}
function quickLinks(brand, links) {
  return el("div", { class: `quick brand-${brand}` }, links.map(([label, sub, url]) =>
    el("a", { href: url, target: ext(url) ? "_blank" : null, rel: "noopener" }, label, el("small", {}, sub))));
}
async function recentImages(n = 12) {
  const { listImages, imageUrl } = await import("./studio.js");
  const items = (await listImages()).slice(0, n);
  if (!items.length) return el("p", { class: "muted" }, "No images yet. Add them in the Design Studio.");
  return el("div", { class: "thumbs" }, items.map((i) => el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" })));
}

// ---------- pages ----------
const C3D_LINKS = [
  ["Website", "charleston3d.com", BRANDS.c3d.site],
  ["Products", "Pick what's on the site", "#products"],
  ["Shopify admin", "Orders and products", BRANDS.c3d.admin.url],
  ["Order maker", "hype-chain-maker", "https://hype-chain-maker.netlify.app"],
  ["Nameplates", "nameplate-maker", "https://nameplate-maker.netlify.app"],
  ["File finder", "3d-print-file-finder", "https://3d-print-file-finder.netlify.app"],
  ["Print trends", "print-trends", "https://print-trends.netlify.app"],
];
const ED_LINKS = [
  ["Store", "theelevateddesignsllc.com", BRANDS.ed.site],
  ["Orders", "Shopify admin", "https://theelevateddesignsllc.com/admin/orders"],
  ["Products", "Shopify admin", "https://theelevateddesignsllc.com/admin/products"],
  ["Add a product", "Shopify admin", "https://theelevateddesignsllc.com/admin/products/new"],
  ["Designs and listings", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/"],
  ["Launch plan", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/plan"],
  ["Market calendar", "Elevated Designs app", "https://charlestonprintdesigns.netlify.app/#/cal"],
  ["Design a shirt", "Design Studio", "#studio"],
  ["Discounts", "Shopify admin", "https://theelevateddesignsllc.com/admin/discounts"],
];

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
    header(today, "Dashboard", "Both businesses at a glance. Press / to jump anywhere.",
      [el("button", { class: "btn", type: "button", onclick: openPalette }, "Jump to… ", el("kbd", {}, "/")),
       el("a", { class: "btn primary", href: "#studio" }, "New design")]),
    el("div", { class: "kpis" },
      el("button", { class: "kpi warn", type: "button", onclick: () => go("map", "attn") }, el("b", {}, String(attn.length)), el("span", {}, "need attention")),
      el("button", { class: "kpi", type: "button", onclick: () => go("map", "live") }, el("b", {}, String(count((s) => s.status === "live"))), el("span", {}, "live services")),
      el("button", { class: "kpi", type: "button", onclick: () => go("map", "empty") }, el("b", {}, String(count((s) => s.status === "empty"))), el("span", {}, "never launched")),
      el("button", { class: "kpi bad", type: "button", onclick: () => go("map", "blind") }, el("b", {}, String(count((s) => s.status === "blind"))), el("span", {}, "not connected"))),
    el("div", { class: "grid-2" },
      el("section", { class: "panel brand-c3d brand-band" },
        el("div", { class: "panel-head" }, el("h2", {}, "Charleston 3D"), el("a", { class: "btn ghost", href: "#c3d" }, "Open")),
        el("p", { class: "muted" }, BRANDS.c3d.tagline), quickLinks("c3d", C3D_LINKS.slice(0, 4))),
      el("section", { class: "panel brand-ed brand-band" },
        el("div", { class: "panel-head" }, el("h2", {}, "Elevated Designs"), el("a", { class: "btn ghost", href: "#ed" }, "Open")),
        el("p", { class: "muted" }, BRANDS.ed.tagline), quickLinks("ed", ED_LINKS.slice(0, 4)))),
    el("div", { class: "grid-2" },
      el("section", { class: "panel" }, el("h2", {}, "Needs you"), alertsList(attn)),
      el("section", { class: "panel" }, el("h2", {}, "Today's tasks"),
        todoWidget("bc-todo", [{ t: "Pick which Charleston 3D products go on the new site", d: false }, { t: "Check Netlify credit usage", d: false }]))),
    el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Latest images"), el("a", { class: "btn ghost", href: "#studio" }, "Open library")), imgs),
  ];
}

function brandPage(key, links, extra = []) {
  const b = BRANDS[key];
  const mine = SERVICES.filter((s) => s.brand === key);
  return [
    header("Business", b.name, b.tagline, [linkBtn(b.admin, "btn"), linkBtn({ label: "View live site", url: b.site }, `btn brand brand-${key}`)]),
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

async function productsPage() {
  const { renderProducts } = await import("./products.js");
  return [header("Charleston 3D", "Products", "Pick which designs are on charleston3d.com. Switching one on makes it active in Shopify and rebuilds the site."), await renderProducts()];
}

async function studioPage() {
  const { renderStudio } = await import("./studio.js");
  return [header("Elevated Designs", "Design Studio", "Browse your whole image library, drag images onto a shirt, and export a print-ready file."), await renderStudio()];
}

// ---------- router ----------
const view = document.getElementById("view");
let pendingFilter = null;
export function go(route, filter) { pendingFilter = filter ?? null; location.hash = route; }
async function render() {
  const route = (location.hash.slice(1) || "dashboard").split("/")[0];
  document.querySelectorAll(".nav").forEach((a) => a.dataset.route === route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const pages = {
    dashboard,
    c3d: () => brandPage("c3d", C3D_LINKS),
    ed: () => brandPage("ed", ED_LINKS, [el("section", { class: "panel brand-ed" },
      el("div", { class: "panel-head" }, el("h2", {}, "Design Studio"), el("a", { class: "btn brand", href: "#studio" }, "Open studio")),
      el("p", { class: "muted" }, "Your image library and shirt designer. Images are stored online, so you can design from any device."))]),
    map: () => mapPage(pendingFilter ?? "all"),
    studio: studioPage,
    products: productsPage,
  };
  const make = pages[route] ?? dashboard;
  const nodes = await make();
  pendingFilter = null;
  view.replaceChildren(...[nodes].flat());
  document.title = `${{ dashboard: "Dashboard", c3d: "Charleston 3D", ed: "Elevated Designs", map: "Service Map", studio: "Design Studio", products: "Products" }[route] ?? "Dashboard"} · Business Console`;
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
addEventListener("hashchange", render);
render();
