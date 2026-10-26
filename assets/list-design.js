// "List a design" on the Elevated Designs Products page: every design in the online image library
// gets an "Add to Elevated Designs" button. It opens a short sheet filled in from the listing
// template (assets/listing.js): which blanks (shirts) to offer and in which colors, a markup on
// the catalog prices, and the copy. One "List it" puts it on elevatedshirts.com, live
// straight away, with Blank, Color and Size options. Elevated Designs only: the server refuses any
// other store, and Charleston 3D never shows this panel.
import { el, toast } from "./app.js";
import { STORES, api, host } from "./api.js";
import { SIZES, blankLabel, buildListing, colorSlug, describe, presetColors, seoFor, variantsFor } from "./listing.js";

const LISTABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const fileUrl = (key) => `/api/images/${encodeURIComponent(key)}`;
const ext = () => el("span", { class: "ext", "aria-hidden": "true" }, "↗");

let template = null; // from GET /api/listings, once per page load
const listed = new Map(); // imageKey -> { url, adminUrl, title } for this visit
// imageKey -> { body, out } for a listing Shopify is still making. Opening that design again goes
// back to Check again, so a second List it can't start a second product while the first is made.
const pendingOps = new Map();

export function listPanel({ onListed = () => {} } = {}) {
  const state = { items: [], q: "", loading: false, error: null, loaded: false };
  const site = host(STORES.ed.site);
  const search = el("input", { class: "field", type: "search", id: "lib-q", placeholder: "Search designs", "aria-label": "Search designs" });
  const reload = el("button", { class: "btn ghost", type: "button", id: "lib-refresh" }, "Refresh");
  const count = el("p", { class: "muted small", id: "lib-count", "aria-live": "polite" });
  const grid = el("div", { class: "ldesigns", role: "list", "aria-labelledby": "lib-title" });
  const section = el("section", { class: "panel brand-band brand-ed", id: "list-design", "aria-labelledby": "lib-title" },
    el("div", { class: "panel-head" }, el("h2", { id: "lib-title" }, `List a design on ${site}`), el("a", { class: "btn ghost", href: "#studio" }, "Open Design Studio")),
    el("p", { class: "muted" }, "Pick a design from the image library. Add to Elevated Designs opens a ready-made T-shirt listing (shirts, colors, sizes, prices, description, SEO) to check, and List it puts it on the store, live straight away."),
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
  const lengthCounter = (input, max) => {
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
    const cat = tpl.catalog, L = tpl.limits;
    const l = buildListing(item, tpl);
    const dirty = { desc: false, seoTitle: false, seoDesc: false };
    // What's offered: blank id -> chosen color names, in catalog order.
    const chosenColors = new Map(l.blanks.map((b) => [b.id, new Set(b.colors)]));
    const title = el("input", { class: "field", id: "ls-title", required: true, maxlength: String(L.title), value: l.title, autocomplete: "off" });
    const markup = el("input", { class: "field", id: "ls-markup", type: "number", inputmode: "decimal", min: String(L.markupMin), max: String(L.markupMax), step: "0.01", value: "0" });
    const counter = el("p", { class: "vcount", id: "ls-count", "aria-live": "polite" });
    const summary = el("p", { class: "muted small", id: "ls-summary" });
    const sizes = el("fieldset", { class: "lsizes" }, el("legend", {}, "Sizes (each shirt offers the ones it comes in)"),
      ...SIZES.map((s) => el("label", {}, el("input", { type: "checkbox", value: s, id: `ls-size-${s}`, checked: l.sizes.includes(s) }), s)));
    const type = el("input", { class: "field", id: "ls-type", required: true, maxlength: "60", value: tpl.productType });
    const tags = el("input", { class: "field", id: "ls-tags", value: l.tags.join(", "), autocomplete: "off" });
    const desc = el("textarea", { class: "field", id: "ls-desc", rows: "8", required: true, maxlength: String(L.descriptionHtml) });
    desc.value = l.descriptionHtml;
    const seoTitle = el("input", { class: "field", id: "ls-seo-title", required: true, maxlength: String(L.seoTitle), value: l.seoTitle });
    const seoDesc = el("textarea", { class: "field", id: "ls-seo-desc", rows: "3", required: true, maxlength: String(L.seoDescription) });
    seoDesc.value = l.seoDescription;
    const c1 = lengthCounter(seoTitle, L.seoTitle), c2 = lengthCounter(seoDesc, L.seoDescription);
    const err = el("div", { class: "state state-error", role: "alert", id: "ls-error", hidden: true });
    const submit = el("button", { class: "btn brand", type: "submit", id: "ls-submit" }, "List it");
    const cancel = el("button", { class: "btn", type: "button", id: "ls-cancel", onclick: () => dlg.close() }, "Cancel");

    // ----- shirts to offer, grouped by type -----
    const from = (b) => Math.min(...Object.values(b.prices));
    const blankRow = (b) => {
      const on = chosenColors.has(b.id);
      const box = el("input", { type: "checkbox", id: `ls-blank-${b.id}`, "data-blank": b.id, checked: on });
      const colors = el("div", { class: "lcolors", id: `ls-colors-${b.id}`, role: "group", "aria-label": `Colors for ${blankLabel(b)}`, hidden: !on },
        ...b.colors.map((c) => el("label", { class: "lcolor", title: c.name },
          el("input", { type: "checkbox", id: `ls-color-${b.id}-${colorSlug(c.name)}`, "data-blank": b.id, value: c.name, checked: on && chosenColors.get(b.id).has(c.name) }),
          el("span", { class: "sw", style: `background:${/^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : "#ccc"}`, "aria-hidden": "true" }), c.name)));
      box.addEventListener("change", () => {
        if (box.checked) chosenColors.set(b.id, new Set(presetColors(b)));
        else chosenColors.delete(b.id);
        colors.querySelectorAll("input").forEach((i) => (i.checked = box.checked && chosenColors.get(b.id).has(i.value)));
        colors.hidden = !box.checked;
        update();
      });
      colors.addEventListener("change", (e) => {
        const set = chosenColors.get(b.id);
        if (!set) return;
        e.target.checked ? set.add(e.target.value) : set.delete(e.target.value);
        update();
      });
      return el("div", { class: "lblank", "data-blank": b.id },
        el("label", { class: "lblank-head" }, box,
          el("span", { class: "stack", style: "gap:0" }, el("strong", {}, `${b.brand} ${b.style} ${b.name}`),
            el("span", { class: "muted small" }, `${cat.tiers[b.tier] ?? b.tier} · ${b.fit} · ${b.fabric} · from $${from(b).toFixed(2)}`))),
        colors);
    };
    const groups = Object.entries(cat.types).map(([t, label]) => {
      const list = cat.blanks.filter((b) => b.type === t);
      if (!list.length) return null;
      const open = list.some((b) => chosenColors.has(b.id));
      return el("details", { class: "lgroup", open, "data-type": t }, el("summary", {}, label, el("span", { class: "muted small", "data-picked": t })), ...list.map(blankRow));
    });
    const shirts = el("fieldset", { class: "lshirts", id: "ls-shirts" }, el("legend", {}, "Shirts to offer"),
      cat.pricing?.placeholder || cat.costsAreEstimates ? el("p", { class: "muted small" }, `Prices come from the blank catalog (updated ${cat.updated}) and are still placeholders: check them, or add a markup.`) : null,
      ...groups);

    const chosenSizes = () => [...sizes.querySelectorAll("input:checked")].map((i) => i.value);
    const offer = () => cat.blanks.filter((b) => chosenColors.get(b.id)?.size).map((b) => ({ id: b.id, colors: b.colors.map((c) => c.name).filter((n) => chosenColors.get(b.id).has(n)) }));
    const markupVal = () => (markup.value.trim() === "" ? 0 : Number(markup.value));
    const base = () => ({ title: title.value.trim() || l.title, handlingDays: tpl.handlingDays, catalog: cat, blanks: offer(), sizes: chosenSizes() });
    let count = 0;
    function update() {
      const b = base();
      if (!dirty.desc) desc.value = describe(b);
      const seo = seoFor(b);
      if (!dirty.seoTitle) seoTitle.value = seo.seoTitle;
      if (!dirty.seoDesc) seoDesc.value = seo.seoDescription;
      c1.paint(); c2.paint();
      const m = markupVal();
      const vs = Number.isFinite(m) ? variantsFor(cat, { blanks: b.blanks, sizes: b.sizes, markup: m }) : [];
      count = vs.length;
      const over = count > L.variants;
      counter.className = `vcount${over ? " over" : count > L.standardVariants ? " warn" : ""}`;
      counter.textContent = `${count.toLocaleString("en-US")} variant${count === 1 ? "" : "s"} of ${L.variants.toLocaleString("en-US")}`
        + (over ? `: too many. Offer fewer shirts, colors or sizes.` : count > L.standardVariants ? `. Over ${L.standardVariants}: Shopify makes it in the background, and a store without extended variants stops at ${L.standardVariants}.` : "");
      submit.disabled = over || busy;
      const prices = vs.map((v) => v.price);
      summary.textContent = count
        ? `${b.blanks.length} shirt${b.blanks.length === 1 ? "" : "s"}, ${b.blanks.reduce((n, x) => n + x.colors.length, 0)} colors, $${Math.min(...prices).toFixed(2)} to $${Math.max(...prices).toFixed(2)}. Printed to order, stock isn't tracked. Goes live on ${host(STORES.ed.site)} as soon as you press List it.`
        : "Pick at least one shirt, a color and a size.";
      groups.forEach((g) => { if (!g) return; const n = cat.blanks.filter((x) => x.type === g.dataset.type && chosenColors.get(x.id)?.size).length; g.querySelector("[data-picked]").textContent = n ? ` · ${n} picked` : ""; });
    }
    desc.addEventListener("input", () => (dirty.desc = true));
    seoTitle.addEventListener("input", () => (dirty.seoTitle = true));
    seoDesc.addEventListener("input", () => (dirty.seoDesc = true));
    [title, markup].forEach((i) => i.addEventListener("input", update));
    sizes.addEventListener("change", update);

    const f = el("form", { class: "stack lform", novalidate: true },
      head(item), err,
      field("Title", title),
      el("div", { class: "lgrid" }, field("Markup on catalog prices ($)", markup, el("span", { class: "muted small" }, "Added to every size's price; 0 uses the catalog."))),
      counter, summary,
      shirts,
      el("details", { class: "lmore" }, el("summary", {}, "Sizes, tags, description and SEO"),
        el("div", { class: "stack" },
          sizes,
          field("Product type", type),
          field("Tags", tags, el("span", { class: "muted small" }, "Separate with commas.")),
          field("Description (HTML)", desc),
          field("SEO title", seoTitle, c1.node),
          field("SEO description", seoDesc, c2.node))),
      el("div", { class: "row sheet-actions" }, cancel, submit));

    const send = async (body) => {
      busy = true; submit.disabled = true; cancel.disabled = true; submit.textContent = "Listing…"; f.setAttribute("aria-busy", "true");
      let out;
      try {
        out = await api("/api/listings", { method: "POST", key: true, body, reason: "Listing a design on the store needs the console key (the CONSOLE_KEY value set for this console)." });
      } catch (e2) {
        busy = false; cancel.disabled = false; submit.textContent = "List it"; f.removeAttribute("aria-busy"); update();
        showErr(e2.message, e2.details?.product?.adminUrl);
        if (e2.code === "partly_listed" && e2.details?.product) onDone(item.key, { url: e2.details.product.url, adminUrl: e2.details.product.adminUrl, product: e2.details.product });
        return;
      }
      busy = false;
      if (out.pending) { pendingOps.set(item.key, { body, out }); return waiting(item, body, out); }
      result(item, out);
      toast(out.message ?? "Listed");
      onDone(item.key, out);
    };

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      err.hidden = true;
      const blanks = offer();
      if (!blanks.length) { showErr("Pick at least one shirt to offer, with at least one color."); shirts.querySelector("input").focus(); return; }
      if (!chosenSizes().length) { showErr("Pick at least one size."); f.querySelector(".lmore").open = true; sizes.querySelector("input").focus(); return; }
      // The server refuses a shirt that comes in none of the chosen sizes; say so here instead.
      const sizeless = blanks.map((s) => cat.blanks.find((b) => b.id === s.id)).find((b) => !chosenSizes().some((z) => b.sizes.includes(z)));
      if (sizeless) {
        showErr(`${blankLabel(sizeless)} comes in none of the chosen sizes (it has ${sizeless.sizes.join(", ")}). Pick one of those sizes or stop offering it.`);
        f.querySelector(".lmore").open = true;
        const box = f.querySelector(`#ls-blank-${CSS.escape(sizeless.id)}`);
        if (box?.closest("details")) box.closest("details").open = true;
        box?.focus(); return;
      }
      if (count > L.variants) { showErr(counter.textContent); return; }
      if (!f.checkValidity()) {
        const bad = f.querySelector(":invalid:not(fieldset)");
        if (bad?.closest(".lmore")) f.querySelector(".lmore").open = true;
        bad?.reportValidity?.();
        bad?.focus();
        return;
      }
      await send({
        store: "ed", imageKey: item.key, title: title.value.trim(), blanks, sizes: chosenSizes(), markup: markupVal(),
        productType: type.value.trim(), tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
        descriptionHtml: desc.value.trim(), seoTitle: seoTitle.value.trim(), seoDescription: seoDesc.value.trim(),
      });
    });
    function showErr(msg, admin) {
      err.replaceChildren(el("strong", {}, "Not listed yet"), el("p", {}, msg),
        admin ? el("div", { class: "row" }, el("a", { class: "btn", id: "ls-err-admin", href: admin, target: "_blank", rel: "noopener" }, "Open in Shopify", ext())) : null);
      err.hidden = false;
      err.scrollIntoView?.({ block: "nearest" });
    }
    update();
    return f;
  }

  // A big listing Shopify is still making: ask again with its operation id (never a second product).
  function waiting(item, body, out) {
    const check = el("button", { class: "btn brand", type: "button", id: "ls-check" }, "Check again");
    const msg = el("p", {}, out.message ?? "");
    dlg.replaceChildren(head(item),
      el("div", { class: "state state-setup", id: "ls-pending", role: "status" }, el("strong", {}, "Still being made in Shopify"), msg),
      el("div", { class: "row sheet-actions" }, el("button", { class: "btn", type: "button", id: "ls-later", onclick: () => dlg.close() }, "Close"), check));
    check.addEventListener("click", async () => {
      if (busy) return;
      busy = true; check.disabled = true; check.textContent = "Checking…";
      try {
        const next = await api("/api/listings", { method: "POST", key: true, body: { ...body, operationId: out.operationId } });
        busy = false;
        if (next.pending) { check.disabled = false; check.textContent = "Check again"; msg.textContent = next.message ?? ""; return; }
        pendingOps.delete(item.key);
        result(item, next);
        toast(next.message ?? "Listed");
        onDone(item.key, next);
      } catch (e) {
        busy = false; check.disabled = false; check.textContent = "Check again";
        msg.textContent = e.message;
        // Shopify has no such operation: let List it start afresh next time.
        if (e.code === "not_found") pendingOps.delete(item.key);
        if (e.code === "partly_listed" && e.details?.product) onDone(item.key, { url: e.details.product.url, adminUrl: e.details.product.adminUrl, product: e.details.product });
      }
    });
    check.focus();
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
    const p = pendingOps.get(item.key);
    if (p) return waiting(item, p.body, p.out);
    dlg.replaceChildren(form(item, template));
    dlg.querySelector("#ls-title").focus();
  }
  return { open };
}
