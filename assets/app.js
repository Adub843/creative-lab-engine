import { BRANDS, STATUS, SERVICES, ROUTES, CLEANUP, TOPOLOGY, GO_TO } from "./data.js";
import { GROUPS, TOOLS, toolsFor } from "./tools.js";
import { takeStoreHandler, cancelKeyPrompt, consoleKey } from "./api.js";
import { filesPage } from "./files.js";
import { meshyPage } from "./meshy.js";
import { drivePage } from "./drive.js";

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
  document.querySelectorAll(".toast").forEach((old) => old.remove());
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
const PAGES = () => [
  { name: "Home", url: `#home/${currentStore()}`, kind: "Page" },
  ...["c3d", "ed"].flatMap((k) => toolsFor(k).filter((t) => t.store === k || k === currentStore())
    .map((t) => ({ name: t.store ? t.name : `${t.name}: ${BRANDS[k].name}`, url: toolHref(t, k), kind: t.store ? BRANDS[t.store].name : "Page", store: k }))),
];
const pal = document.getElementById("palette");
const palQ = document.getElementById("pal-q");
const palList = document.getElementById("pal-list");
function palItems(q) {
  const all = [...PAGES(), ...GO_TO.flatMap((g) => g.links.map((l) => ({ name: l.label, url: l.url, kind: g.group }))), ...SERVICES.flatMap((s) => s.links.map((l) => ({ name: `${s.name}: ${l.label}`, url: l.url, kind: BRANDS[s.brand].name })))];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((i) => words.every((w) => i.name.toLowerCase().includes(w))).slice(0, 12);
}
function drawPal() {
  const items = palItems(palQ.value);
  palList.replaceChildren(...items.map((i, n) => el("li", { role: "option", "aria-selected": String(n === 0) },
    el("a", { href: i.url, target: ext(i.url) ? "_blank" : null, rel: "noopener", onclick: () => { if (i.store) setStore(i.store, false); pal.close(); } },
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
async function recentImages(n = 12) {
  const { listImages, imageUrl } = await import("./studio.js");
  const { isLogo, isOtherBrand } = await import("./image-filters.js");
  const items = (await listImages()).filter((i) => !isLogo(i) && !isOtherBrand(i)).slice(0, n);
  if (!items.length) return el("p", { class: "muted" }, "No images yet. Add them in the Art library.");
  return el("div", { class: "thumbs" }, items.map((i) => el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" })));
}

// ---------- store, sidebar and top bar ----------
// The store is picked once in the sidebar and every page follows it. It lives in the address
// (#marketing/ed) so a link opens the same store, and on this device for next time.
const STORE_KEYS = ["c3d", "ed"];
export function currentStore() {
  const fromHash = location.hash.slice(1).split("/")[1];
  if (STORE_KEYS.includes(fromHash)) return fromHash;
  const saved = store.get("bc-store", "c3d");
  return STORE_KEYS.includes(saved) ? saved : "c3d";
}
export const toolHref = (t, k = currentStore()) =>
  t.url ? t.url(BRANDS[k]) : `#${t.page ?? t.id}/${k}${t.path ? `/${t.path}` : ""}`;
// The tool the address points at: the page route, plus its sub-path (List a design is #products/ed/list).
function activeTool() {
  const [route, , sub] = location.hash.slice(1).split("/");
  const k = currentStore();
  return toolsFor(k).find((t) => (t.page ?? t.id) === route && (t.path ?? null) === (sub ?? null))
    ?? toolsFor(k).find((t) => (t.page ?? t.id) === route && !t.path);
}

// The Go to menu: both shops, both apps, the EPIX3D maker site and the reference pages, from every page.
// The art library and the shirt designer are pages of this console (the Design Studio was folded in on 2026-11-07).
const goMenu = el("div", { class: "go-menu", id: "go-menu", popover: "auto", role: "menu", "aria-label": "Go to" },
  GO_TO.map((g) => el("div", { class: "go-group" }, el("span", { class: "eyebrow" }, g.group),
    g.links.map((l) => el("a", { class: "go-link", href: l.url, target: "_blank", rel: "noopener", role: "menuitem", onclick: () => goMenu.hidePopover?.() },
      el("span", { class: "go-text" }, el("strong", {}, l.label), el("span", { class: "muted" }, l.note)),
      el("span", { class: "ext", "aria-hidden": "true" }, "↗"))))));
document.body.append(goMenu);
const goBtn = el("button", { class: "btn ghost go-btn", type: "button", popovertarget: "go-menu", "aria-haspopup": "menu", title: "Go to every site and app" },
  el("span", { class: "go-ico", "aria-hidden": "true" }, "⊞"), "Go to");

const seg = document.getElementById("store-seg");
const navs = document.getElementById("navs");
STORE_KEYS.forEach((k) => seg.append(el("button", { type: "button", class: `seg-btn brand-${k}`, "data-store": k, "aria-label": BRANDS[k].name, onclick: () => setStore(k) },
  el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "long" }, BRANDS[k].name),
  el("span", { class: "short", "aria-hidden": "true" }, k === "ed" ? "Elevated" : "Charleston 3D"))));

function drawNav() {
  const k = currentStore();
  document.documentElement.dataset.store = k;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.store === k)));
  const route = location.hash.slice(1).split("/")[0] || "home";
  const active = activeTool();
  const link = (id, label, ico, href) => el("a", { class: "nav", href, "data-route": id, target: ext(href) ? "_blank" : null, rel: ext(href) ? "noopener" : null,
    "aria-current": (active ? active.id === id : route === id) ? "page" : null },
    el("span", { class: "ico", "aria-hidden": "true" }, ico), el("span", {}, label), ext(href) ? el("span", { class: "nav-ext", "aria-hidden": "true" }, "↗") : null);
  navs.replaceChildren(
    link("home", "Home", "⌂", `#home/${k}`),
    ...GROUPS.map((g) => {
      const items = toolsFor(k).filter((t) => t.group === g.id);
      return items.length ? el("div", { class: "nav-group" }, el("span", { class: "nav-label" }, g.name),
        items.map((t) => link(t.id, t.name, t.ico, toolHref(t, k)))) : null;
    }).filter(Boolean));
  const b = BRANDS[k];
  document.getElementById("store-links").replaceChildren(
    el("a", { class: "btn ghost", href: b.site, target: "_blank", rel: "noopener" }, "Live site", el("span", { class: "ext", "aria-hidden": "true" }, "↗")),
    el("a", { class: "btn ghost", href: b.admin.url, target: "_blank", rel: "noopener" }, "Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗")),
    b.app ? el("a", { class: "btn ghost hide-sm", href: b.app, target: "_blank", rel: "noopener" }, "App", el("span", { class: "ext", "aria-hidden": "true" }, "↗")) : null,
    goBtn);
  const crumb = document.getElementById("crumb");
  const g = active && GROUPS.find((x) => x.id === active.group);
  crumb.replaceChildren(el("span", { class: `crumb-store brand-${k}` }, b.name),
    ...(g ? [el("span", { "aria-hidden": "true" }, "/"), el("span", {}, g.name)] : []),
    el("span", { "aria-hidden": "true" }, "/"), el("strong", {}, active ? active.name : route === "home" ? "Home" : "Home"));
}

// Switching store: pages that show one store's data reload in place; a tool only the other store
// has (the shirt designer, Maker Studio) gives way to Home.
export function setStore(k, navigate = true) {
  if (!STORE_KEYS.includes(k)) return;
  store.set("bc-store", k);
  if (!navigate) return;
  const [route, , ...rest] = location.hash.slice(1).split("/");
  const r = route || "home";
  const t = activeTool();
  // A page both stores have (the Art library) stays open on the other store's side.
  const twin = t && toolsFor(k).some((x) => (x.page ?? x.id) === (t.page ?? t.id) && (x.path ?? null) === (t.path ?? null));
  const keeps = r === "home" || r === "map" || (t && (!t.store || twin));
  const next = keeps ? `#${[r, k, ...rest].join("/")}` : `#home/${k}`;
  const handler = keeps && r !== "home" && r !== "map" ? pageStoreHandler : null;
  if (handler) {
    history.replaceState(null, "", next); drawNav(); handler(k);
    // The page heading names the store; keep it in step with the page that just reloaded in place.
    const eyebrow = view.querySelector(".page-head .eyebrow");
    if (eyebrow && STORE_KEYS.some((s) => BRANDS[s].name === eyebrow.textContent)) eyebrow.textContent = BRANDS[k].name;
    document.title = document.title.replace(/· [^·]+ · Creative Lab Studios$/, `· ${BRANDS[k].name} · Creative Lab Studios`);
  }
  else location.hash = next;
}
let pageStoreHandler = null;

document.getElementById("search").addEventListener("click", () => openPalette());
const moreBtn = document.getElementById("more");
moreBtn.addEventListener("click", () => {
  const open = !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
  moreBtn.setAttribute("aria-expanded", String(open));
});
navs.addEventListener("click", (e) => { if (e.target.closest("a")) { document.body.classList.remove("nav-open"); moreBtn.setAttribute("aria-expanded", "false"); } });

// ---------- pages ----------
const brandLogo = (key) => el("img", { class: `brand-logo logo-${key}`, src: BRANDS[key].logo, alt: "", width: 120, height: 40 });

function header(eyebrow, title, sub, actions = []) {
  return el("header", { class: "page-head" },
    el("div", { class: "stack" }, el("span", { class: "eyebrow" }, eyebrow), el("h1", {}, title), sub ? el("p", { class: "muted" }, sub) : null),
    el("div", { class: "row" }, actions));
}

// Home: what needs Aaron today. The tools themselves are in the sidebar (More on a phone), and every
// service is on the Service map, so Home doesn't repeat them.
function home() {
  const k = currentStore();
  const b = BRANDS[k];
  const attn = SERVICES.filter((s) => s.brand === k && s.status === "attn");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const tasks = el("div", {}, el("p", { class: "muted" }, "Loading tasks…"));
  import("./team.js").then(({ homeTasks }) => homeTasks(k, !!consoleKey.get())).then((n) => tasks.replaceChildren(...[n].flat()))
    .catch(() => tasks.replaceChildren(el("a", { class: "btn ghost", href: `#team/${k}` }, "Open the Team board")));
  const brief = el("div", {}, el("p", { class: "muted" }, "Loading the agents' report…"));
  import("./team.js").then(({ homeBrief }) => homeBrief(!!consoleKey.get())).then((n) => brief.replaceChildren(...[n].flat()))
    .catch(() => brief.replaceChildren(el("a", { class: "btn ghost", href: "#team" }, "Open the handoff board")));
  const imgs = el("div", {}, el("p", { class: "muted" }, "Loading images…"));
  if (k === "ed") recentImages().then((n) => imgs.replaceChildren(n)).catch(() => imgs.replaceChildren(el("p", { class: "muted" }, "Couldn't load images.")));
  const starts = k === "ed" ? startTiles() : null;
  const primary = k === "ed" ? el("a", { class: "btn primary", href: "#products/ed/list" }, "List a design")
    : el("a", { class: "btn primary", href: "#makerstudio/c3d" }, "Open Maker Studio");
  return [
    el("div", { class: `home-head brand-${k}` }, el("div", { class: `brand-chip logo-${k}` }, brandLogo(k)),
      header(today, b.name, b.tagline, [primary])),
    el("div", { class: "grid-2" },
      el("section", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", {}, "Needs you"), el("a", { class: "btn ghost", href: `#map/${k}` }, "Service map")), alertsList(attn)),
      el("section", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", {}, "Your tasks")), tasks)),
    el("section", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", {}, "Agents' report")), brief),
    starts,
    k === "ed" ? el("section", { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", {}, "Latest designs"), el("a", { class: "btn ghost", href: "#designs/ed" }, "Open Art library")), imgs) : null,
  ];
}

// Start a design: one tile per shirt style, on the same real shirt photos the designer uses (assets/blanks).
const START_STYLES = [["tee", "T-shirt"], ["hoodie", "Hoodie"], ["longsleeve", "Long sleeve"], ["tank", "Tank top"], ["crew", "Crewneck"], ["fitted", "Fitted tee"]];
function startTiles() {
  const open = async (style) => { const { startDesign } = await import("./studio.js"); startDesign(style); location.hash = "#studio/ed"; };
  return el("section", { class: "panel", "aria-labelledby": "starts-h" },
    el("div", { class: "panel-head" }, el("h2", { id: "starts-h" }, "Start a design"), el("a", { class: "btn ghost", href: "#studio/ed" }, "Open the shirt designer")),
    el("div", { class: "starts" }, START_STYLES.map(([style, name]) => el("button", { class: "start", type: "button", "data-style": style, onclick: () => open(style) },
      el("span", { class: "start-pic", "aria-hidden": "true" },
        el("img", { class: "start-shade", src: `assets/blanks/${style}-front-shade.jpg`, alt: "", loading: "lazy" }),
        el("img", { class: "start-base", src: `assets/blanks/${style}-front.jpg`, alt: "", loading: "lazy" })),
      el("span", { class: "start-name" }, name)))));
}

// A self-contained tool app (assets in /tools/<slug>/), shown full size inside the console.
const OLD_MAKERS = ["nameplate", "hypechain", "maker"];
function framePage(t, tab) {
  const src = tab && /^[a-z0-9-]+$/.test(tab) ? `${t.frame}#${tab}` : t.frame;
  const frame = el("iframe", { class: "tool-frame", src, title: t.name, loading: "eager", allow: "clipboard-write; fullscreen" });
  return [
    el("header", { class: "page-head tool-head" },
      el("div", { class: "stack" }, el("h1", {}, t.name), el("p", { class: "muted" }, t.sub)),
      el("div", { class: "row" }, el("a", { class: "btn ghost", href: src, target: "_blank", rel: "noopener" }, "Open full screen", el("span", { class: "ext", "aria-hidden": "true" }, "↗")))),
    frame,
  ];
}

function mapPage(initial = "all") {
  const FILTERS = [["all", "All"], ["c3d", "Charleston 3D"], ["ed", "Elevated Designs"], ["other", "Other"], ["attn", "Needs attention"], ["blind", "Not connected"]];
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
  if (location.hash.split("/")[2] === "list") setTimeout(() => document.getElementById("lib-title")?.scrollIntoView({ block: "start" }), 400);
  return [header(BRANDS[currentStore()].name, "Products", "Pick which designs are live on each store's Shopify site. Switching one on makes it active and publishes it to the Online Store, so it shows up right away."), await renderProducts()];
}

async function insightsPage() {
  const { renderInsights } = await import("./insights.js");
  return [header(BRANDS[currentStore()].name, "Insights", "Sales, visits and a 30-day forecast from Shopify, with what to do next."), await renderInsights()];
}

async function marketingPage() {
  const { renderMarketing } = await import("./marketing.js");
  return [header(BRANDS[currentStore()].name, "Marketing", "Search, local, Bing and AI-assistant health for each site, checked every morning, with the fixes right here."), await renderMarketing()];
}

async function promotePage() {
  const { renderPromotions } = await import("./promotions.js");
  return [header(BRANDS[currentStore()].name, "Promotions", "Shopify's marketing tools for each store: discounts, gift cards, customer groups, campaigns, sales channels and abandoned checkouts."), await renderPromotions()];
}

async function teamPage() {
  const { renderTeam } = await import("./team.js");
  return [header(BRANDS[currentStore()].name, "Team", "Your tasks and the agents', saved online so every device sees the same board, plus when each scheduled job runs."), await renderTeam()];
}

async function studioPage() {
  const { renderStudio } = await import("./studio.js");
  return [header("Elevated Designs", "Shirt designer", "Pick art from the library, place it on a real shirt photo, and download the print file or a mockup. No key needed to design."), await renderStudio()];
}

async function pricesPage() {
  const { renderPrices } = await import("./prices.js");
  return [header("Elevated Designs", "Price sheet", "The shirt price sheet, size by size: what each blank costs, what the store charges for it plain and with a design. Prices are changed in the sheet; the store follows within 15 minutes."), await renderPrices()];
}

// ---------- router ----------
// #<page>/<store>[/<sub>]. Old addresses keep working: #dashboard is Home, #c3d and #ed are Home for that store.
const view = document.getElementById("view");
let pendingFilter = null;
export function go(route, filter) { pendingFilter = filter ?? null; location.hash = `${route}/${currentStore()}`; }
// Share & QR: this store's links, each with a QR code made in the browser (tools/vendor/qrcode.js).
let qrLib;
const loadQr = () => qrLib ??= new Promise((ok, fail) => {
  const s = document.createElement("script");
  s.src = "tools/vendor/qrcode.js"; s.onload = () => ok(window.qrcode); s.onerror = () => { qrLib = null; fail(new Error("QR library didn't load")); };
  document.head.append(s);
});
function qrCanvas(qr, url, cell) {
  const q = qr(0, "M"); q.addData(url); q.make();
  const n = q.getModuleCount(), pad = 4, size = (n + pad * 2) * cell;
  const c = el("canvas", { width: size, height: size, role: "img", "aria-label": `QR code for ${url}` });
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) g.fillRect((col + pad) * cell, (r + pad) * cell, cell, cell);
  return c;
}
function shareCard(qr, { label, url, note }) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const save = () => qrCanvas(qr, url, 24).toBlob((blob) => {
    const a = el("a", { href: URL.createObjectURL(blob), download: `${slug}-qr.png` }); document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }, "image/png");
  const copy = () => navigator.clipboard.writeText(url).then(() => toast("Link copied"), () => toast("Couldn't copy. Press and hold the link instead."));
  return el("section", { class: "panel share-card" },
    el("div", { class: "share-qr" }, qrCanvas(qr, url, 6)),
    el("div", { class: "stack" }, el("h2", {}, label), note ? el("p", { class: "muted small" }, note) : null,
      el("a", { class: "share-url", href: url, target: "_blank", rel: "noopener" }, url.replace(/^https:\/\//, "")),
      el("div", { class: "row" },
        el("button", { class: "btn primary", type: "button", onclick: save }, "Download QR"),
        el("button", { class: "btn", type: "button", onclick: copy }, "Copy link"),
        navigator.share ? el("button", { class: "btn", type: "button", onclick: () => navigator.share({ title: label, url }).catch(() => {}) }, "Send") : null)));
}
async function sharePage() {
  const k = currentStore(), b = BRANDS[k];
  const head = header("Stats & marketing", "Share & QR", `Every ${b.name} link with a QR code. Print them on market signs, packing slips and cards.`);
  let qr;
  try { qr = await loadQr(); } catch { return [head, el("p", { class: "muted" }, "The QR maker didn't load. Reload the page to try again.")]; }
  const links = [{ label: `${b.name} store`, url: b.site, note: "The shop, with Shopify checkout." },
    { label: k === "ed" ? "Shirt builder app" : "Order app", url: b.app, note: k === "ed" ? "Customers build their own shirt and order it." : "Shop, or request a custom print." }];
  const grid = el("div", { class: "share-grid" }, links.map((l) => shareCard(qr, l)));
  const out = el("div");
  const field = el("input", { class: "field", type: "url", placeholder: "https://…", "aria-label": "Any link", style: "max-width:420px" });
  const make = (e) => {
    e.preventDefault();
    let url = field.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { toast("That doesn't look like a link."); return; }
    out.replaceChildren(shareCard(qr, { label: "Your link", url }));
  };
  return [head, grid,
    el("section", { class: "panel stack" }, el("h2", {}, "QR for any link"),
      el("p", { class: "muted small" }, "Paste a product page, a collection or a sale link."),
      el("form", { class: "row", onsubmit: make }, field, el("button", { class: "btn", type: "submit" }, "Make QR")), out)];
}

// Each page this console shows gets a place in the browser history, so Back can tell whether
// there is a console page to go back to, or whether it should go to this brand's Home instead.
let lastStep = -1;
function markStep() {
  const i = history.state?.step;
  lastStep = Number.isInteger(i) ? i : lastStep + 1;
  if (!Number.isInteger(i)) history.replaceState({ ...history.state, step: lastStep }, "");
}
function backButton(k) {
  const home = `#home/${k}`;
  return el("a", { class: "back-btn", href: home, onclick: (e) => { if (lastStep > 0) { e.preventDefault(); history.back(); } } },
    el("span", { "aria-hidden": "true" }, "‹"), " Back");
}
// Every page but Home gets a Back button at the top of its heading.
function addBack(nodes, k) {
  const head = nodes.find((n) => n?.classList?.contains("page-head"));
  if (head) head.firstElementChild?.prepend(backButton(k));
  else nodes.unshift(el("div", { class: "back-bar" }, backButton(k)));
}

async function render() {
  let [route = "", second, third] = location.hash.slice(1).split("/");
  // The makers used to have their own pages; old links open the same maker inside Maker Studio.
  if (OLD_MAKERS.includes(route)) { location.replace(`#makerstudio/c3d/${route}`); return; }
  if (route === "c3d" || route === "ed") { store.set("bc-store", route); history.replaceState(null, "", `#home/${route}`); route = "home"; }
  markStep();
  if (!route || route === "dashboard") route = "home";
  if (STORE_KEYS.includes(second)) store.set("bc-store", second);
  pageStoreHandler = null;
  takeStoreHandler();
  drawNav();
  const k = currentStore();
  const frameTool = TOOLS.find((t) => t.frame && t.id === route);
  // A tool of the other store: show this store's Home rather than mixing the brands.
  if (frameTool && frameTool.store !== k) { location.replace(`#home/${k}`); return; }
  if (((route === "studio" || route === "prices") && k !== "ed") || ((route === "files" || route === "maker3d") && k !== "c3d")) { location.replace(`#home/${k}`); return; }
  const pages = {
    home,
    map: () => mapPage(pendingFilter ?? k),
    studio: studioPage,
    products: productsPage,
    insights: insightsPage,
    marketing: marketingPage,
    promote: promotePage,
    share: sharePage,
    team: teamPage,
    files: () => filesPage(header),
    designs: async () => (await import("./design-library.js")).designLibraryPage(header, k),
    drive: () => drivePage(header, k),
    maker3d: () => meshyPage(header),
    prices: pricesPage,
  };
  const make = frameTool ? () => framePage(frameTool, third) : pages[route] ?? home;
  const nodes = [await make()].flat().filter(Boolean);
  if (make !== home) addBack(nodes, k);
  pageStoreHandler = takeStoreHandler();
  pendingFilter = null;
  view.replaceChildren(...nodes);
  view.classList.toggle("wide", route === "studio" || route === "maker3d" || !!frameTool);
  view.classList.toggle("framed", !!frameTool);
  const t = activeTool();
  document.title = `${t ? t.name : "Home"} · ${BRANDS[k].name} · Creative Lab Studios`;
  drawNav();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
addEventListener("hashchange", () => { cancelKeyPrompt(); render(); });
render();
