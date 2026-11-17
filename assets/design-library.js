// Art library: every image in the online library for the chosen store, on one page, with the same search and
// categories as the shirt designer and List a design. It took over the Design Studio's library on 2026-11-07, so it
// holds every brand's art: Elevated Designs (with its EPIX3D label) on the Elevated Designs side, Charleston 3D on its
// own side. The two never mix (CLAUDE.md rule 3): Charleston 3D art is never public and never offered for a shirt.
// Open an image to rename it, tag it, move it to a category or another brand, choose whether the shirt app shows it,
// put it on a shirt, list it or delete it. Select several to move or hide them together.
// The library itself is lib/images.mjs (GET/PATCH/DELETE /api/images).
import { el, toast } from "./app.js";
import { api, askForKey, consoleKey } from "./api.js";
import { confirmButton } from "./confirm.js";
import { ART_BRANDS, LOGOS, brandOf, brandsFor, categoryOf, displayName, filterBar } from "./image-filters.js";

const API = "/api/images";
const KEY_REASON = "The Art library needs the console key (the CONSOLE_KEY value set for this console).";
const SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["name", "Name A to Z"], ["big", "Largest file"]];
const WEEK = 7 * 24 * 60 * 60 * 1000;
// The shirt designer picks this up on load and puts the image on the shirt.
export const ADD_TO_SHIRT = "bc-add-to-shirt";

const urlOf = (i) => i.url ?? `${API}/${encodeURIComponent(i.key)}`;
const sizeOf = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n ?? 0) / 1024))} KB`;
const fmt = (n) => n.toLocaleString();
// replaceChildren and append turn null into the text "null", so the optional parts are left out first.
const put = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k != null));

export async function designLibraryPage(header, store = "ed") {
  const c3d = store === "c3d";
  const mine = brandsFor(store);
  const head = header(c3d ? "Charleston 3D" : "Elevated Designs", "Art library", c3d
    ? "Charleston 3D's logos, photos and art, saved online. Private to the team: it never shows in the shirt app."
    : "Every Elevated Designs and EPIX3D image, saved online. Open one to rename it, tag it, change its category, show it in the shirt app or put it on a shirt.");
  const state = { items: [], sort: "new", brand: "", selecting: false, picked: new Set() };
  const filters = filterBar({ onChange: () => draw(), shows: !c3d, id: "dl" });
  const sort = el("select", { class: "field", id: "dl-sort", "aria-label": "Sort" }, SORTS.map(([v, l]) => el("option", { value: v }, l)));
  const selectBtn = el("button", { class: "btn", type: "button", id: "dl-select", "aria-pressed": "false" }, "Select");
  const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", multiple: true, hidden: true, id: "dl-file" });
  // New uploads go to this brand (Elevated Designs can upload for its EPIX3D label too).
  const upBrand = el("select", { class: "field", id: "dl-up-brand", "aria-label": "Brand for new uploads", hidden: c3d }, mine.map((b) => el("option", { value: b }, `Upload to ${ART_BRANDS[b]}`)));
  const uploadBtn = el("button", { class: "btn primary", type: "button", id: "dl-upload", onclick: () => fileIn.click() }, "Upload");
  const brandSeg = el("div", { class: "seg", role: "group", "aria-label": "Brand", id: "dl-brands", hidden: true });
  const stats = el("section", { class: "kpis dl-stats", "aria-label": "Library numbers" });
  const count = el("p", { class: "muted small", id: "dl-count", role: "status" }, "Loading the library…");
  const grid = el("div", { class: "dl-grid", role: "list", "aria-label": "Art" });
  const bulk = el("div", { class: "dl-bulk", hidden: true, role: "region", "aria-label": "Selected images" });
  const syncLine = el("p", { class: "muted small", id: "dl-sync" });
  const cats = el("datalist", { id: "dl-cats" });

  const known = () => [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort();
  const sorted = (list) => {
    const by = { new: (a, b) => (b.added ?? 0) - (a.added ?? 0), old: (a, b) => (a.added ?? 0) - (b.added ?? 0),
      name: (a, b) => displayName(a).localeCompare(displayName(b)), big: (a, b) => (b.size ?? 0) - (a.size ?? 0) };
    return [...list].sort(by[state.sort]);
  };
  const inBrand = (i) => !state.brand || brandOf(i) === state.brand;

  function tile(i) {
    const picked = state.picked.has(i.key);
    return el("button", { class: `dl-tile${picked ? " picked" : ""}`, type: "button", role: "listitem", "data-key": i.key, "aria-pressed": state.selecting ? String(picked) : null,
      onclick: () => state.selecting ? toggle(i) : openDetail(i) },
      el("span", { class: "dl-pic" }, el("img", { src: urlOf(i), alt: "", loading: "lazy", decoding: "async" })),
      el("span", { class: "dl-meta" }, el("strong", {}, displayName(i)),
        el("span", { class: "muted small" }, categoryOf(i),
          brandOf(i) === "epix3d" ? el("span", { class: "dl-badge dl-epix" }, "EPIX3D") : null,
          i.public === true ? el("span", { class: "dl-badge" }, "Shirt app") : null)),
      state.selecting ? el("span", { class: "dl-check", "aria-hidden": "true" }, picked ? "✓" : "") : null);
  }
  const stat = (label, value, sub, onclick) => el("button", { class: "kpi", type: "button", onclick }, el("span", {}, label), el("b", { class: "num" }, value), sub ? el("small", { class: "muted" }, sub) : null);
  function drawStats() {
    const list = state.items.filter(inBrand), pub = list.filter((i) => i.public === true).length;
    const fresh = list.filter((i) => (i.added ?? 0) > Date.now() - WEEK).length;
    const show = (v) => { const s = document.getElementById("dl-show"); if (s) { s.value = v; s.dispatchEvent(new Event("change")); } };
    put(stats,
      stat("Images", fmt(list.length), state.brand ? `In ${ART_BRANDS[state.brand]}` : c3d ? "Charleston 3D art" : "Elevated Designs and EPIX3D", () => show("")),
      c3d ? null : stat("In the shirt app", fmt(pub), "Customers can pick these", () => show("app")),
      stat("Private", fmt(list.length - pub), "Only the team sees these", () => show("private")),
      stat("Added this week", fmt(fresh), "Uploads and saved designs", () => { sort.value = state.sort = "new"; show(""); draw(); }));
  }
  function drawBrands() {
    const counts = Object.fromEntries(mine.map((b) => [b, state.items.filter((i) => brandOf(i) === b).length]));
    brandSeg.hidden = c3d || !counts.epix3d;
    if (state.brand && !counts[state.brand]) state.brand = "";
    brandSeg.replaceChildren(...[["", "All"], ...mine.map((b) => [b, ART_BRANDS[b]])].map(([b, label]) =>
      el("button", { class: "seg-btn", type: "button", "data-brand": b, "aria-pressed": String(b === state.brand),
        onclick: () => { state.brand = b; filters.setItems(state.items.filter(inBrand)); drawBrands(); draw(); } }, label)));
  }
  function draw() {
    const all = state.items.filter(inBrand);
    const shown = sorted(filters.apply(all));
    count.textContent = all.length ? `${shown.length} of ${all.length} images` : c3d ? "No Charleston 3D art yet. Upload logos, photos or art." : "No images yet. Upload some, or add them to the Kittl library folder.";
    grid.replaceChildren(...shown.map(tile));
    if (all.length && !shown.length) grid.append(el("p", { class: "muted" }, "Nothing matches. Try another category or search."));
    drawStats();
    drawBulk(shown);
  }
  const toggle = (i) => { state.picked.has(i.key) ? state.picked.delete(i.key) : state.picked.add(i.key); draw(); };
  const relist = () => { state.items = state.items.filter((i) => mine.includes(brandOf(i))); filters.setItems(state.items.filter(inBrand)); refreshCats(); drawBrands(); draw(); };

  // ----- several at once -----
  function drawBulk(shown) {
    bulk.hidden = !state.selecting;
    if (!state.selecting) return;
    const n = state.picked.size;
    const catIn = el("input", { class: "field", id: "dl-bulk-cat", list: "dl-cats", placeholder: "Category name", "aria-label": "Move to category" });
    const brandTo = c3d ? null : el("select", { class: "field", id: "dl-bulk-brand", "aria-label": "Move to brand" }, mine.map((b) => el("option", { value: b }, ART_BRANDS[b])));
    put(bulk,
      el("strong", {}, `${n} selected`),
      el("button", { class: "btn ghost", type: "button", onclick: () => { shown.forEach((i) => state.picked.add(i.key)); draw(); } }, `Select all ${shown.length}`),
      n ? el("button", { class: "btn ghost", type: "button", onclick: () => { state.picked.clear(); draw(); } }, "Clear") : null,
      el("span", { class: "dl-bulk-acts" },
        catIn, el("button", { class: "btn", type: "button", disabled: !n, id: "dl-bulk-move", onclick: () => { const c = catIn.value.trim(); if (!c) { toast("Type a category first"); catIn.focus(); return; } patchMany({ category: c }, `Moved to ${c}`); } }, "Move"),
        brandTo, brandTo ? el("button", { class: "btn", type: "button", disabled: !n, id: "dl-bulk-brand-go", onclick: () => patchMany({ brand: brandTo.value }, `Moved to ${ART_BRANDS[brandTo.value]}`) }, "Set brand") : null,
        c3d ? null : el("button", { class: "btn", type: "button", disabled: !n, onclick: () => patchMany({ public: true }, "Showing in the shirt app") }, "Show in shirt app"),
        c3d ? null : el("button", { class: "btn", type: "button", disabled: !n, onclick: () => patchMany({ public: false }, "Hidden from the shirt app") }, "Hide from shirt app"),
        n ? confirmButton(`Delete ${n}`, `Delete ${n} for good?`, () => deleteMany(), "btn danger") : null));
  }
  async function patchOne(i, patch) {
    const out = await api(`${API}/${encodeURIComponent(i.key)}`, { method: "PATCH", key: true, body: patch, reason: KEY_REASON });
    Object.assign(i, out.item);
    if (out.item && !("brand" in out.item) && patch.brand) i.brand = patch.brand;
    return i;
  }
  async function patchMany(patch, done) {
    const list = state.items.filter((i) => state.picked.has(i.key));
    let ok = 0, failed = 0;
    for (const [n, i] of list.entries()) {
      count.textContent = `Saving ${n + 1} of ${list.length}…`;
      try { await patchOne(i, patch); ok++; } catch { failed++; }
    }
    state.picked.clear(); relist();
    toast(failed ? `${done}: ${ok} done, ${failed} didn't save. Try those again.` : `${done}: ${ok} image${ok === 1 ? "" : "s"}`);
  }
  async function deleteOne(i) {
    await api(`${API}/${encodeURIComponent(i.key)}`, { method: "DELETE", key: true, reason: KEY_REASON });
    state.items = state.items.filter((x) => x.key !== i.key);
  }
  async function deleteMany() {
    const list = state.items.filter((i) => state.picked.has(i.key));
    let failed = 0;
    for (const i of list) { try { await deleteOne(i); } catch { failed++; } }
    state.picked.clear(); relist();
    toast(failed ? `${list.length - failed} deleted, ${failed} couldn't be deleted` : `Deleted ${list.length}`);
  }

  // ----- one image -----
  const dlg = el("dialog", { class: "sheet dl-sheet", id: "dl-sheet", "aria-labelledby": "dl-title" });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  function openDetail(i) {
    const name = el("input", { class: "field", id: "dl-name", maxlength: "120", value: displayName(i) === i.name ? i.name : (i.name?.startsWith("kittl-") ? "" : i.name ?? ""), placeholder: displayName(i), autocomplete: "off" });
    const cat = el("input", { class: "field", id: "dl-cat", list: "dl-cats", maxlength: "60", value: i.category ?? "", placeholder: categoryOf(i), autocomplete: "off" });
    const tags = el("input", { class: "field", id: "dl-tags", maxlength: "200", value: i.tags ?? "", placeholder: "e.g. halloween, anchor, navy", autocomplete: "off" });
    // Charleston 3D art stays with Charleston 3D; Elevated Designs art can move to its EPIX3D label and back,
    // or over to Charleston 3D if it was filed under the wrong brand (it then leaves the shirt app).
    const brandSel = el("select", { class: "field", id: "dl-brand" }, (c3d ? ["c3d", "ed"] : ["ed", "epix3d", "c3d"]).map((b) => el("option", { value: b }, ART_BRANDS[b])));
    brandSel.value = brandOf(i);
    const pub = el("input", { type: "checkbox", id: "dl-pub", checked: i.public === true });
    const pubRow = el("label", { class: "row small", hidden: c3d }, pub, "Show in the shirt app (customers can put it on a shirt)");
    const brandNote = el("p", { class: "muted small", hidden: true });
    const syncBrand = () => {
      const toC3d = brandSel.value === "c3d";
      pub.disabled = toC3d; if (toC3d) pub.checked = false;
      brandNote.hidden = brandSel.value === brandOf(i);
      brandNote.textContent = toC3d ? "Moves it to the Charleston 3D art library. Charleston 3D art never shows in the shirt app."
        : brandSel.value === "ed" && c3d ? "Moves it to the Elevated Designs art library." : `Moves it to ${ART_BRANDS[brandSel.value]}.`;
    };
    brandSel.addEventListener("change", syncBrand);
    syncBrand();
    const save = el("button", { class: "btn primary", type: "submit", id: "dl-save" }, "Save");
    const form = el("form", { class: "stack" },
      el("label", { class: "lfield" }, el("span", {}, "Name"), name),
      el("div", { class: "dl-two" },
        el("label", { class: "lfield" }, el("span", {}, "Category"), cat),
        el("label", { class: "lfield" }, el("span", {}, "Brand"), brandSel)),
      el("span", { class: "muted small" }, "Pick a category or type a new one. Categories show on every image panel."),
      brandNote,
      el("label", { class: "lfield" }, el("span", {}, "Tags"), tags),
      pubRow,
      categoryOf(i) === LOGOS ? el("p", { class: "note small" }, "This is a brand logo from Kittl, so it stays private and isn't offered in List a design.") : null,
      el("div", { class: "row" }, save));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      save.disabled = true; save.textContent = "Saving…";
      const patch = { category: cat.value.trim(), tags: tags.value.trim() };
      if (!c3d) patch.public = pub.checked;
      if (brandSel.value !== brandOf(i)) patch.brand = brandSel.value;
      if (name.value.trim()) patch.name = name.value.trim();
      try {
        await patchOne(i, patch);
        relist(); dlg.close();
        toast(patch.brand ? `Moved to ${ART_BRANDS[patch.brand]}` : "Saved");
      } catch (err) { toast(err.message); save.disabled = false; save.textContent = "Save"; }
    });
    const kind = (i.type ?? "").replace("image/", "").replace("+xml", "").toUpperCase();
    dlg.replaceChildren(
      el("div", { class: "dl-sheet-grid" },
        el("div", { class: "dl-big" }, el("img", { src: urlOf(i), alt: displayName(i) })),
        el("div", { class: "stack" },
          el("div", { class: "row", style: "justify-content:space-between;align-items:start" },
            el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "eyebrow" }, `${ART_BRANDS[brandOf(i)]} · ${categoryOf(i)}`), el("h2", { id: "dl-title", class: "wrap" }, displayName(i)),
              el("span", { class: "muted small" }, `${kind} · ${sizeOf(i.size)} · added ${new Date(i.added ?? Date.now()).toLocaleDateString()}`)),
            el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
          form,
          el("hr"),
          el("div", { class: "dl-acts" },
            c3d ? null : el("button", { class: "btn", type: "button", id: "dl-shirt", onclick: () => { try { sessionStorage.setItem(ADD_TO_SHIRT, i.key); } catch { /* storage blocked */ } dlg.close(); location.hash = "#studio/ed"; } }, "Put on a shirt"),
            !c3d && categoryOf(i) !== LOGOS ? el("a", { class: "btn", href: "#products/ed/list", onclick: () => dlg.close() }, "List it for sale") : null,
            el("a", { class: "btn", href: urlOf(i), download: `${displayName(i)}.${(i.type ?? "image/png").split(/[/+]/)[1].replace("jpeg", "jpg")}` }, "Download"),
            confirmButton("Delete", "Delete for good?", async () => {
              try { await deleteOne(i); relist(); dlg.close(); toast("Deleted"); } catch (err) { toast(err.message); }
            }, "btn danger")))));
    dlg.showModal();
    name.focus();
  }

  // ----- upload -----
  async function upload(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return toast("Only image files can go in the Art library.");
    if (!consoleKey.get() && !(await askForKey(KEY_REASON))) return;
    const { upload: send } = await import("./studio.js");
    const brand = c3d ? "c3d" : upBrand.value;
    let ok = 0;
    for (const [n, f] of list.entries()) {
      count.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try {
        const r = await send(f, "", false, brand);
        if (r.saved === "cloud") { state.items.unshift({ brand, ...r.item }); ok++; }
      } catch (e) { toast(e.message); break; }
    }
    relist();
    if (ok) toast(c3d ? `Uploaded ${ok} to the Charleston 3D art library.` : `Uploaded ${ok} to ${ART_BRANDS[brand]}. They're private until you tick Show in the shirt app.`);
  }
  fileIn.addEventListener("change", () => { upload(fileIn.files); fileIn.value = ""; });
  const section = el("section", { class: "panel stack dl" });
  section.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  section.addEventListener("drop", (e) => { if (e.dataTransfer?.files.length) { e.preventDefault(); upload(e.dataTransfer.files); } });

  const refreshCats = () => cats.replaceChildren(...known().map((c) => el("option", { value: c })));
  async function load() {
    try {
      const out = await api(API, { key: true, reason: KEY_REASON });
      state.items = (out.items ?? []).filter((i) => mine.includes(brandOf(i)));
      relist();
    } catch (e) {
      count.textContent = "";
      stats.replaceChildren();
      grid.replaceChildren(el("div", { class: "state state-error", role: "alert" }, el("strong", {}, "Couldn't load the library"), el("p", {}, e.message),
        el("button", { class: "btn", type: "button", onclick: load }, "Try again")));
    }
  }
  // When the hourly Kittl sync last copied Elevated Designs art in (counts only, no key needed).
  async function showSync() {
    try {
      const s = await (await fetch("/api/library-sync", { headers: { accept: "application/json" } })).json();
      const at = s?.finishedAt ?? s?.ranAt ?? s?.at;
      const n = (v) => Array.isArray(v) ? v.length : (v ?? 0);
      syncLine.textContent = at ? `Kittl art last synced ${new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}: ${n(s.added)} added, ${n(s.removed)} removed. It runs every hour.` : "";
    } catch { syncLine.textContent = ""; }
  }
  sort.addEventListener("change", () => { state.sort = sort.value; draw(); });
  selectBtn.addEventListener("click", () => {
    state.selecting = !state.selecting; state.picked.clear();
    selectBtn.setAttribute("aria-pressed", String(state.selecting)); selectBtn.textContent = state.selecting ? "Done" : "Select";
    draw();
  });
  if (!consoleKey.get()) count.textContent = "The Art library needs the console key.";
  load();
  if (!c3d) showSync();
  put(section,
    el("div", { class: "dl-top" }, filters.el, el("div", { class: "row dl-top-acts" }, sort, selectBtn, upBrand, uploadBtn, fileIn)),
    brandSeg, bulk, count, grid, cats, c3d ? null : syncLine);
  return [head, stats, section, dlg];
}
