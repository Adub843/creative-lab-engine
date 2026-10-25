// Products: pick which designs are live on each store's Shopify site.
// Switching one on makes it active in Shopify and publishes it to the Online Store channel, so the
// theme shows it straight away. The switch flips at once and flips back if Shopify says no.
import { el, toast } from "./app.js";
import { SETUP_URL, STORES, api, host, initialStore, money, storeSwitcher } from "./api.js";

const API = "/api/products";
const FILTERS = [["all", "All products"], ["live", "Live on the site"], ["off", "Not live"], ["draft", "Drafts"]];

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
  const switcher = storeSwitcher(state.store, (k) => { state.store = k; load(); });

  wrap.append(
    el("div", { class: "panel-head" }, title, switcher),
    el("div", { class: "toolbar" }, search, filter, refresh),
    summary, list);

  const matches = (p) => {
    const f = state.filter;
    if (f === "live" && !p.live) return false;
    if (f === "off" && p.live) return false;
    if (f === "draft" && p.status !== "DRAFT") return false;
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
      type: "button", class: "switch", role: "switch", "aria-checked": String(p.live), "data-id": p.id,
      "aria-label": `Live on ${host(STORES[state.store].site)}: ${p.title}`, "aria-busy": p.pending ? "true" : null,
      "aria-disabled": p.pending ? "true" : null, onclick: () => toggle(p),
    }, el("span", { class: "knob", "aria-hidden": "true" }));
    const statusPill = el("span", { class: `pill ${p.status === "ACTIVE" ? "s-live" : p.status === "ARCHIVED" ? "s-blind" : "s-empty"}` },
      { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" }[p.status] ?? p.status);
    const view = p.live
      ? el("a", { class: "btn", href: p.url, target: "_blank", rel: "noopener", "data-act": "view" }, "View on site", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))
      : el("span", { class: "btn is-off", "aria-disabled": "true", title: "Switch it on to put it on the site" }, "Not on site");
    return el("div", { class: `prow${p.pending ? " pending" : ""}`, role: "listitem", "data-id": p.id },
      p.image ? el("img", { src: thumb(p.image), alt: "", width: "56", height: "56", loading: "lazy" }) : el("span", { class: "noimg", "aria-hidden": "true" }, "▢"),
      el("div", { class: "pinfo" },
        el("strong", {}, p.title),
        el("span", { class: "muted small" }, [p.type, p.price != null ? money(p.price, p.currency) : null,
          p.inventory != null ? `${p.inventory} in stock` : null].filter(Boolean).join(" · ")),
        el("span", { class: "tags" }, statusPill)),
      el("label", { class: "plive" }, sw, el("span", {}, p.pending ? "Saving…" : p.live ? "Live" : "Off")),
      el("div", { class: "pacts" }, view,
        el("a", { class: "btn ghost", href: p.adminUrl, target: "_blank", rel: "noopener", "data-act": "edit" }, "Edit in Shopify", el("span", { class: "ext", "aria-hidden": "true" }, "↗"))));
  }

  function draw() {
    const s = STORES[state.store];
    wrap.className = `panel brand-band brand-${state.store}`;
    title.textContent = `Products on ${host(s.site)}`;
    const focusedId = document.activeElement?.closest?.(".plist") ? document.activeElement.dataset.id : null;
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
    if (focusedId) list.querySelector(`.switch[data-id="${CSS.escape(focusedId)}"]`)?.focus();
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
      Object.assign(p, before);
      toast(e.code === "cancelled" ? e.message : `Couldn't change ${p.title}: ${e.message}`);
    } finally {
      p.pending = false;
      if (state.store === storeAt) draw();
    }
  }

  async function load() {
    const id = ++state.req;
    state.loading = true; state.error = null; draw();
    try {
      const out = await api(`${API}?store=${encodeURIComponent(state.store)}`);
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
  load();
  return wrap;
}
