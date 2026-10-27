// Products: pick which designs are live on each store's Shopify site.
// Switching one on makes it active in Shopify and publishes it to the Online Store channel, so the
// theme shows it straight away. The switch flips at once and flips back if Shopify says no.
// Charleston 3D rows also have a Customizable switch (the "customizable" tag: the theme then asks
// for a name to print). Elevated Designs rows have a Shirt builder switch instead (the "builder-blank"
// tag: the blank shows in the shirt apps), plus the "List a design" panel (list-design.js).
import { el, toast } from "./app.js";
import { SETUP_URL, STORES, api, host, initialStore, money, storeSwitcher } from "./api.js";
import { listPanel } from "./list-design.js";

const API = "/api/products";
const FILTERS = [["all", "All products"], ["live", "Live on the site"], ["off", "Not live"], ["draft", "Drafts"], ["builder", "In the shirt builder"]];
// The second switch on each row: one per store, never shared between the brands.
const TAG_SWITCH = {
  c3d: { field: "customizable", label: "Customizable", aria: "Customizable (asks for a name to print)",
    title: (site) => `On: ${site} shows the "Name to print" field for this product`,
    on: (t) => `${t} now asks for a name to print`, off: (t) => `${t} no longer asks for a name` },
  ed: { field: "builder", label: "Shirt builder", aria: "Offered in the shirt builder",
    title: () => "On: customers can pick this blank in the shirt apps (they update within the hour)",
    on: (t) => `${t} is in the shirt builder`, off: (t) => `${t} is out of the shirt builder` },
};

const thumb = (url) => {
  try { const u = new URL(url); u.searchParams.set("width", "96"); return u.toString(); } catch { return url; }
};

export async function renderProducts() {
  const state = { store: initialStore(), products: [], q: "", filter: "all", loading: true, error: null, req: 0 };

  const wrap = el("section", { class: "panel brand-band", "aria-labelledby": "prod-title" });
  const title = el("h2", { id: "prod-title" });
  const search = el("input", { class: "field", type: "search", id: "prod-q", placeholder: "Search by name or type", "aria-label": "Search products" });
  const filter = el("select", { class: "field", id: "prod-filter", "aria-label": "Show" }, FILTERS.map(([v, l]) => el("option", { value: v }, l)));
  const refresh = el("button", { class: "btn ghost", type: "button", id: "prod-refresh" }, "Refresh");
  const summary = el("p", { class: "muted small", id: "prod-summary", "aria-live": "polite" });
  const list = el("div", { class: "plist", role: "list", "aria-labelledby": "prod-title" });
  const switcher = storeSwitcher(state.store, (k) => { state.store = k; panel.show(k === "ed"); load(); });
  // A new listing shows up in the Elevated Designs list straight away.
  const panel = listPanel({ onListed: () => { if (state.store === "ed") load(); } });

  wrap.append(
    el("div", { class: "panel-head" }, title, switcher),
    el("div", { class: "toolbar" }, search, filter, refresh),
    summary, list);

  const matches = (p) => {
    const f = state.filter;
    if (f === "live" && !p.live) return false;
    if (f === "off" && p.live) return false;
    if (f === "draft" && p.status !== "DRAFT") return false;
    if (f === "builder" && !p.builder) return false;
    const q = state.q.trim().toLowerCase();
    return !q || `${p.title} ${p.type} ${p.handle}`.toLowerCase().includes(q);
  };

  function stateBox(kind, heading, text, actions = []) {
    return el("div", { class: `state state-${kind}`, role: kind === "error" ? "alert" : null },
      el("strong", {}, heading), text ? el("p", {}, text) : null, actions.length ? el("div", { class: "row" }, actions) : null);
  }
  const retryBtn = () => el("button", { class: "btn", type: "button", onclick: load }, "Try again");

  function row(p) {
    const sw = el("button", {
      type: "button", class: "switch", role: "switch", "aria-checked": String(p.live), "data-id": p.id, "data-field": "live",
      "aria-label": `Live on ${host(STORES[state.store].site)}: ${p.title}`, "aria-busy": p.pending ? "true" : null,
      "aria-disabled": p.pending ? "true" : null, onclick: () => toggle(p),
    }, el("span", { class: "knob", "aria-hidden": "true" }));
    // Charleston 3D: some 3D files can't be personalized. Elevated Designs: which blanks the shirt apps offer.
    const ts = TAG_SWITCH[state.store];
    const pendingTag = p.pendingTag === ts.field;
    const tagged = el("label", { class: "plive pcust", title: ts.title(host(STORES[state.store].site)) },
      el("button", {
        type: "button", class: "switch", role: "switch", "aria-checked": String(!!p[ts.field]), "data-id": p.id, "data-field": ts.field,
        "aria-label": `${ts.aria}: ${p.title}`, "aria-busy": pendingTag ? "true" : null,
        "aria-disabled": pendingTag ? "true" : null, onclick: () => toggleTag(p, state.store),
      }, el("span", { class: "knob", "aria-hidden": "true" })),
      el("span", {}, pendingTag ? "Saving…" : ts.label));
    const statusPill = el("span", { class: `pill ${p.status === "ACTIVE" ? "s-live" : p.status === "ARCHIVED" ? "s-blind" : "s-empty"}` },
      { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" }[p.status] ?? p.status);
    const view = p.live
      ? el("a", { class: "btn", href: p.url, target: "_blank", rel: "noopener", "data-act": "view" }, "View on site", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))
      : el("span", { class: "btn is-off", "aria-disabled": "true", title: "Switch it on to put it on the site" }, "Not on site");
    return el("div", { class: `prow${p.pending || p.pendingTag ? " pending" : ""}`, role: "listitem", "data-id": p.id },
      p.image ? el("img", { src: thumb(p.image), alt: "", width: "56", height: "56", loading: "lazy" }) : el("span", { class: "noimg", "aria-hidden": "true" }, "▢"),
      el("div", { class: "pinfo" },
        el("strong", {}, p.title),
        el("span", { class: "muted small" }, [p.type, p.price != null ? money(p.price, p.currency) : null,
          p.inventory != null ? `${p.inventory} in stock` : null].filter(Boolean).join(" · ")),
        el("span", { class: "tags" }, statusPill)),
      el("div", { class: "pswitches" },
        el("label", { class: "plive" }, sw, el("span", {}, p.pending ? "Saving…" : p.live ? "Live" : "Off")),
        tagged),
      el("div", { class: "pacts" }, view,
        el("a", { class: "btn ghost", href: p.adminUrl, target: "_blank", rel: "noopener", "data-act": "edit" }, "Edit in Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))));
  }

  function draw() {
    const s = STORES[state.store];
    wrap.className = `panel brand-band brand-${state.store}`;
    title.textContent = `Products on ${host(s.site)}`;
    // "In the shirt builder" is an Elevated Designs filter only.
    const builderOpt = filter.querySelector('option[value="builder"]');
    builderOpt.hidden = builderOpt.disabled = state.store !== "ed";
    if (state.store !== "ed" && state.filter === "builder") { state.filter = filter.value = "all"; }
    const focused = document.activeElement?.closest?.(".plist") ? document.activeElement : null;
    const focusedId = focused?.dataset.id, focusedField = focused?.dataset.field ?? "live";
    list.setAttribute("aria-busy", String(state.loading));

    if (state.loading) { summary.textContent = `Loading ${s.name} products…`; list.replaceChildren(el("p", { class: "muted" }, "Loading…")); return; }
    if (state.error) {
      const e = state.error;
      summary.textContent = "";
      if (e.code === "not_connected" || e.code === "bad_config") {
        list.replaceChildren(stateBox("setup", `${s.name} isn't connected yet`, e.message,
          [el("a", { class: "btn", href: SETUP_URL, target: "_blank", rel: "noopener" }, "How to connect a store", el("span", { class: "ext", "aria-hidden": "true" }, "↗")), retryBtn()]));
      } else {
        list.replaceChildren(stateBox("error", `Couldn't load ${s.name} products`, e.message, [retryBtn()]));
      }
      return;
    }
    const all = state.products;
    const shown = all.filter(matches);
    const liveCount = all.filter((p) => p.live).length;
    summary.textContent = all.length
      ? `${liveCount} of ${all.length} products are live on ${host(s.site)}. Showing ${shown.length}. Changes show on the site right away.`
      : "";
    if (!all.length) {
      list.replaceChildren(stateBox("empty", `No products in ${s.name} yet`, "Add one in Shopify, then come back to put it on the site.",
        [el("a", { class: "btn", href: `${s.site}/admin/products/new`, target: "_blank", rel: "noopener" }, "Add a product in Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))]));
      return;
    }
    if (!shown.length) {
      list.replaceChildren(stateBox("empty", "Nothing matches", "Try another search or filter.",
        [el("button", { class: "btn", type: "button", id: "prod-clear", onclick: () => { search.value = ""; filter.value = "all"; state.q = ""; state.filter = "all"; draw(); search.focus(); } }, "Clear filters")]));
      return;
    }
    list.replaceChildren(...shown.map(row));
    if (focusedId) list.querySelector(`.switch[data-id="${CSS.escape(focusedId)}"][data-field="${CSS.escape(focusedField)}"]`)?.focus();
  }

  async function toggle(p) {
    if (p.pending) return;
    const before = { live: p.live, status: p.status, url: p.url };
    const next = !p.live;
    const storeAt = state.store;
    p.live = next; if (next) p.status = "ACTIVE"; p.pending = true;
    draw();
    try {
      const out = await api(API, { method: "POST", key: true, body: { store: storeAt, id: p.id, live: next } });
      Object.assign(p, out.product ?? { live: out.live, url: out.url });
      toast(next ? `${p.title} is live on ${host(STORES[storeAt].site)}` : `${p.title} is off the site`);
    } catch (e) {
      if (e.code === "partly_published" && e.details?.product) {
        // Made Active but not published: show what Shopify has now, not the old state.
        Object.assign(p, e.details.product);
        toast(`${p.title}: ${e.message}`);
      } else {
        Object.assign(p, before);
        toast(e.code === "cancelled" ? e.message : `Couldn't change ${p.title}: ${e.message}`);
      }
    } finally {
      p.pending = false;
      if (state.store === storeAt) draw();
    }
  }

  async function toggleTag(p, storeAt) {
    const ts = TAG_SWITCH[storeAt];
    if (p.pendingTag || state.store !== storeAt) return;
    const before = !!p[ts.field];
    const next = !before;
    p[ts.field] = next; p.pendingTag = ts.field;
    draw();
    try {
      const out = await api(API, { method: "POST", key: true, body: { store: storeAt, id: p.id, [ts.field]: next } });
      p[ts.field] = out.product?.[ts.field] ?? out[ts.field] ?? next;
      toast(p[ts.field] ? ts.on(p.title) : ts.off(p.title));
    } catch (e) {
      p[ts.field] = before;
      toast(e.code === "cancelled" ? e.message : `Couldn't change ${p.title}: ${e.message}`);
    } finally {
      p.pendingTag = null;
      if (state.store === storeAt) draw();
    }
  }

  async function load() {
    const id = ++state.req;
    state.loading = true; state.error = null; draw();
    try {
      const out = await api(`${API}?store=${encodeURIComponent(state.store)}`, { key: true, reason: "The product list includes drafts and stock levels, so it needs the console key (the CONSOLE_KEY value set for this console)." });
      if (id !== state.req) return;
      state.products = out.products ?? [];
    } catch (e) {
      if (id !== state.req) return;
      state.products = []; state.error = e;
    }
    state.loading = false;
    draw();
  }

  search.addEventListener("input", () => { state.q = search.value; draw(); });
  filter.addEventListener("change", () => { state.filter = filter.value; draw(); });
  refresh.addEventListener("click", load);
  panel.show(state.store === "ed");
  // #products/ed/list (from the Elevated Designs page) goes straight to "List a design".
  if (state.store === "ed" && location.hash.split("/")[2] === "list") requestAnimationFrame(() => panel.el.scrollIntoView({ block: "start" }));
  load();
  return el("div", { class: "stack", style: "gap:24px" }, wrap, panel.el);
}
