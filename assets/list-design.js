// "List a design" on the Elevated Designs Products page: every design in the online image library
// gets an "Add to Elevated Designs" button. It opens a short sheet filled in from the listing
// template (assets/listing.js); everything is editable, and one "List it" puts the T-shirt on
// theelevateddesignsllc.com, live straight away. Elevated Designs only: the server refuses any
// other store, and Charleston 3D never shows this panel.
import { el, toast } from "./app.js";
import { STORES, api, host } from "./api.js";
import { buildListing, describe, seoFor } from "./listing.js";

const LISTABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALL_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const fileUrl = (key) => `/api/images/${encodeURIComponent(key)}`;
const ext = () => el("span", { class: "ext", "aria-hidden": "true" }, "↗");

let template = null; // from GET /api/listings, once per page load
const listed = new Map(); // imageKey -> { url, adminUrl, title } for this visit

export function listPanel({ onListed = () => {} } = {}) {
  const state = { items: [], q: "", loading: false, error: null, loaded: false };
  const site = host(STORES.ed.site);
  const search = el("input", { class: "field", type: "search", id: "lib-q", placeholder: "Search designs", "aria-label": "Search designs" });
  const reload = el("button", { class: "btn ghost", type: "button", id: "lib-refresh" }, "Refresh");
  const count = el("p", { class: "muted small", id: "lib-count", "aria-live": "polite" });
  const grid = el("div", { class: "ldesigns", role: "list", "aria-labelledby": "lib-title" });
  const section = el("section", { class: "panel brand-band brand-ed", id: "list-design", "aria-labelledby": "lib-title" },
    el("div", { class: "panel-head" }, el("h2", { id: "lib-title" }, `List a design on ${site}`), el("a", { class: "btn ghost", href: "#studio" }, "Open Design Studio")),
    el("p", { class: "muted" }, "Pick a design from the image library. Add to Elevated Designs opens a ready-made T-shirt listing (sizes, price, description, SEO) to check, and List it puts it on the store, live straight away."),
    el("div", { class: "toolbar" }, search, reload), count, grid);

  const sheet = theSheet();
  const done = (key, out) => {
    listed.set(key, { url: out.url, adminUrl: out.adminUrl, title: out.product?.title });
    if (document.body.contains(section)) draw();
    onListed(out);
  };

  function card(i) {
    const ok = LISTABLE.has(i.type);
    const was = listed.get(i.key);
    return el("div", { class: "lcard", role: "listitem", "data-key": i.key },
      el("img", { src: fileUrl(i.key), alt: "", loading: "lazy", width: "160", height: "160" }),
      el("div", { class: "lmeta" },
        el("strong", {}, i.name || i.key),
        i.tags ? el("span", { class: "muted small" }, i.tags) : null,
        was ? el("span", { class: "row small" }, el("span", { class: "pill s-live" }, "Listed"),
          el("a", { href: was.url, target: "_blank", rel: "noopener", "data-act": "listed-view" }, "View", ext())) : null),
      ok
        ? el("button", { class: "btn brand", type: "button", "data-act": "list", "aria-label": `Add ${i.name || "this design"} to Elevated Designs`, onclick: (e) => sheet.open(i, e.currentTarget, done) }, "Add to Elevated Designs")
        : el("p", { class: "muted small" }, "SVG can't be a Shopify product photo. Export it as a PNG in the Design Studio to list it."));
  }

  function draw() {
    if (state.loading) { count.textContent = "Loading the image library…"; grid.replaceChildren(); return; }
    if (state.error) {
      count.textContent = "";
      grid.replaceChildren(el("div", { class: "state state-error", role: "alert" }, el("strong", {}, "Couldn't load the image library"), el("p", {}, state.error.message),
        el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: load }, "Try again"))));
      return;
    }
    const q = state.q.trim().toLowerCase();
    const shown = state.items.filter((i) => !q || `${i.name} ${i.tags ?? ""}`.toLowerCase().includes(q));
    count.textContent = state.items.length ? `${shown.length} of ${state.items.length} designs` : "";
    if (!state.items.length) {
      grid.replaceChildren(el("div", { class: "state state-empty" }, el("strong", {}, "No designs in the online library yet"),
        el("p", {}, "Upload them in the Design Studio, then come back to list them."),
        el("div", { class: "row" }, el("a", { class: "btn", href: "#studio" }, "Open Design Studio"))));
      return;
    }
    grid.replaceChildren(...(shown.length ? shown.map(card) : [el("p", { class: "muted" }, "No designs match that search.")]));
  }

  async function load() {
    state.loading = true; state.error = null; draw();
    try {
      const out = await api("/api/images", { key: true, reason: "The image library needs the console key (the CONSOLE_KEY value set for this console)." });
      state.items = out.items ?? [];
    } catch (e) {
      state.items = []; state.error = e;
    }
    state.loading = false; state.loaded = true;
    draw();
  }

  search.addEventListener("input", () => { state.q = search.value; draw(); });
  reload.addEventListener("click", load);
  return {
    el: section,
    show(on) { section.hidden = !on; if (on && !state.loaded && !state.loading) load(); },
  };
}

// ---------- the listing sheet ----------
// One dialog for the whole app, however often the Products page is drawn.
let sheetOnce = null;
const theSheet = () => (sheetOnce ??= makeSheet());
function makeSheet() {
  let onDone = () => {};
  const dlg = el("dialog", { class: "sheet brand-ed", id: "list-sheet", "aria-labelledby": "ls-heading" });
  document.body.append(dlg);
  let opener = null, busy = false;
  dlg.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  dlg.addEventListener("close", () => { opener?.focus?.(); opener = null; });

  const field = (label, input, hint) => el("label", { class: "lfield" }, el("span", {}, label), input, hint ?? null);
  const counter = (input, max) => {
    const c = el("span", { class: "muted small count", "aria-live": "off" });
    const paint = () => { c.textContent = `${input.value.length}/${max}`; c.classList.toggle("over", input.value.length > max); };
    input.addEventListener("input", paint);
    return { node: c, paint };
  };

  function head(item) {
    return el("div", { class: "sheet-head" },
      el("img", { src: fileUrl(item.key), alt: "", width: "64", height: "64" }),
      el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "eyebrow" }, "Elevated Designs"),
        el("h2", { id: "ls-heading" }, "Add to Elevated Designs"),
        el("span", { class: "muted small" }, item.name || item.key)));
  }

  function fail(item, e) {
    dlg.replaceChildren(head(item),
      el("div", { class: "state state-error", role: "alert", id: "ls-error" }, el("strong", {}, "Couldn't open the listing"), el("p", {}, e.message)),
      el("div", { class: "row sheet-actions" },
        el("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Close"),
        el("button", { class: "btn brand", type: "button", id: "ls-retry", onclick: () => open(item, opener, onDone) }, "Try again")));
    dlg.querySelector("#ls-retry").focus();
  }

  function result(item, out) {
    const title = out.alreadyListed ? "Already listed" : `Live on ${host(STORES.ed.site)}`;
    dlg.replaceChildren(head(item),
      el("div", { class: `state ${out.alreadyListed ? "state-setup" : "state-ok"}`, id: "ls-result", role: "status" },
        el("strong", {}, title), el("p", {}, out.message ?? "")),
      el("div", { class: "row sheet-actions" },
        el("a", { class: "btn brand", id: "ls-view", href: out.url, target: "_blank", rel: "noopener" }, "View on site", ext()),
        el("a", { class: "btn", id: "ls-admin", href: out.adminUrl, target: "_blank", rel: "noopener" }, "Open in Shopify", ext()),
        el("button", { class: "btn ghost", type: "button", id: "ls-done", onclick: () => dlg.close() }, "Done")));
    dlg.querySelector("#ls-view").focus();
  }

  function form(item, tpl) {
    const l = buildListing(item, tpl);
    const dirty = { desc: false, seoTitle: false, seoDesc: false };
    const title = el("input", { class: "field", id: "ls-title", required: true, maxlength: String(tpl.limits.title), value: l.title, autocomplete: "off" });
    const price = el("input", { class: "field", id: "ls-price", type: "number", inputmode: "decimal", required: true, min: String(tpl.limits.priceMin), max: String(tpl.limits.priceMax), step: "0.01", value: String(tpl.price) });
    const up = el("input", { class: "field", id: "ls-up", type: "number", inputmode: "decimal", min: "0", max: "100", step: "0.01", value: String(tpl.upcharges["2XL"] ?? 0) });
    const sizes = el("fieldset", { class: "lsizes" }, el("legend", {}, "Sizes"),
      ...ALL_SIZES.map((s) => el("label", {}, el("input", { type: "checkbox", value: s, id: `ls-size-${s}`, checked: tpl.sizes.includes(s) }), s)));
    const type = el("input", { class: "field", id: "ls-type", required: true, maxlength: "60", value: tpl.productType });
    const fabric = el("input", { class: "field", id: "ls-fabric", required: true, maxlength: "120", value: tpl.fabric });
    const tags = el("input", { class: "field", id: "ls-tags", value: l.tags.join(", "), autocomplete: "off" });
    const desc = el("textarea", { class: "field", id: "ls-desc", rows: "6", required: true, maxlength: String(tpl.limits.descriptionHtml) });
    desc.value = l.descriptionHtml;
    const seoTitle = el("input", { class: "field", id: "ls-seo-title", required: true, maxlength: String(tpl.limits.seoTitle), value: l.seoTitle });
    const seoDesc = el("textarea", { class: "field", id: "ls-seo-desc", rows: "3", required: true, maxlength: String(tpl.limits.seoDescription) });
    seoDesc.value = l.seoDescription;
    const c1 = counter(seoTitle, tpl.limits.seoTitle), c2 = counter(seoDesc, tpl.limits.seoDescription);
    const err = el("div", { class: "state state-error", role: "alert", id: "ls-error", hidden: true });
    const submit = el("button", { class: "btn brand", type: "submit", id: "ls-submit" }, "List it");
    const cancel = el("button", { class: "btn", type: "button", id: "ls-cancel", onclick: () => dlg.close() }, "Cancel");
    const summary = el("p", { class: "muted small", id: "ls-summary" });

    const chosen = () => [...sizes.querySelectorAll("input:checked")].map((i) => i.value);
    const upcharges = () => (Number(up.value) > 0 ? { "2XL": Number(up.value) } : {});
    const base = () => ({ title: title.value.trim() || l.title, fabric: fabric.value.trim() || tpl.fabric, handlingDays: tpl.handlingDays, sizes: chosen(), upcharges: upcharges() });
    const regen = () => {
      const b = base();
      if (!dirty.desc) desc.value = describe(b);
      const seo = seoFor(b);
      if (!dirty.seoTitle) seoTitle.value = seo.seoTitle;
      if (!dirty.seoDesc) seoDesc.value = seo.seoDescription;
      c1.paint(); c2.paint();
      const p = Number(price.value), u = Number(up.value) || 0, s = chosen();
      summary.textContent = Number.isFinite(p) && p > 0 && s.length
        ? `${s.length} size${s.length === 1 ? "" : "s"} at $${p.toFixed(2)}${s.includes("2XL") && u > 0 ? `, 2XL $${(p + u).toFixed(2)}` : ""}. Printed to order, stock isn't tracked. Goes live on ${host(STORES.ed.site)} as soon as you press List it.`
        : "Pick at least one size and a price.";
    };
    desc.addEventListener("input", () => (dirty.desc = true));
    seoTitle.addEventListener("input", () => (dirty.seoTitle = true));
    seoDesc.addEventListener("input", () => (dirty.seoDesc = true));
    [title, fabric, price, up].forEach((i) => i.addEventListener("input", regen));
    sizes.addEventListener("change", regen);

    const f = el("form", { class: "stack lform", novalidate: true },
      head(item), err,
      field("Title", title),
      el("div", { class: "lgrid" }, field("Price ($)", price), field("2XL upcharge ($)", up)),
      summary,
      el("details", { class: "lmore" }, el("summary", {}, "Sizes, tags, description and SEO"),
        el("div", { class: "stack" },
          sizes,
          el("div", { class: "lgrid" }, field("Product type", type), field("Fabric line", fabric, el("span", { class: "muted small" }, "Edit to match the blank you print on."))),
          field("Tags", tags, el("span", { class: "muted small" }, "Separate with commas.")),
          field("Description (HTML)", desc),
          field("SEO title", seoTitle, c1.node),
          field("SEO description", seoDesc, c2.node))),
      el("div", { class: "row sheet-actions" }, cancel, submit));

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      err.hidden = true;
      if (!chosen().length) { showErr("Pick at least one size."); f.querySelector(".lmore").open = true; sizes.querySelector("input").focus(); return; }
      if (!f.checkValidity()) {
        const bad = f.querySelector(":invalid:not(fieldset)");
        if (bad?.closest(".lmore")) f.querySelector(".lmore").open = true;
        bad?.reportValidity?.();
        bad?.focus();
        return;
      }
      const body = {
        store: "ed", imageKey: item.key, title: title.value.trim(), price: Number(price.value), sizes: chosen(), upcharges: upcharges(),
        productType: type.value.trim(), tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
        descriptionHtml: desc.value.trim(), seoTitle: seoTitle.value.trim(), seoDescription: seoDesc.value.trim(),
      };
      busy = true; submit.disabled = true; cancel.disabled = true; submit.textContent = "Listing…"; f.setAttribute("aria-busy", "true");
      let out;
      try {
        out = await api("/api/listings", { method: "POST", key: true, body, reason: "Listing a design on the store needs the console key (the CONSOLE_KEY value set for this console)." });
      } catch (e2) {
        busy = false; submit.disabled = false; cancel.disabled = false; submit.textContent = "List it"; f.removeAttribute("aria-busy");
        showErr(e2.message, e2.details?.product?.adminUrl);
        if (e2.code === "partly_listed" && e2.details?.product) onDone(item.key, { url: e2.details.product.url, adminUrl: e2.details.product.adminUrl, product: e2.details.product });
        return;
      }
      busy = false;
      result(item, out);
      toast(out.message ?? "Listed");
      onDone(item.key, out);
    });
    function showErr(msg, admin) {
      err.replaceChildren(el("strong", {}, "Not listed yet"), el("p", {}, msg),
        admin ? el("div", { class: "row" }, el("a", { class: "btn", id: "ls-err-admin", href: admin, target: "_blank", rel: "noopener" }, "Open in Shopify", ext())) : null);
      err.hidden = false;
      err.scrollIntoView?.({ block: "nearest" });
    }
    regen();
    return f;
  }

  async function open(item, from, cb) {
    opener = from ?? document.activeElement;
    onDone = cb ?? (() => {});
    dlg.replaceChildren(head(item), el("p", { class: "muted", id: "ls-loading", role: "status" }, "Getting the listing template…"));
    if (!dlg.open) dlg.showModal();
    try {
      template ??= (await api("/api/listings?store=ed", { key: true, reason: "Listing a design on the store needs the console key (the CONSOLE_KEY value set for this console)." })).template;
    } catch (e) {
      if (!dlg.open) return;
      return fail(item, e);
    }
    if (!dlg.open) return;
    dlg.replaceChildren(form(item, template));
    dlg.querySelector("#ls-title").focus();
  }
  return { open };
}
