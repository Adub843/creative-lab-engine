// Design library (Elevated Designs): every image in the online library on one page, with the same
// search and categories as the shirt designer and List a design. Open an image to rename it, move it to a
// category, choose whether the shirt app shows it, put it on a shirt, list it or delete it. Select several
// to move or hide them together. The library itself is lib/images.mjs (GET/PATCH/DELETE /api/images).
import { el, toast } from "./app.js";
import { api, consoleKey } from "./api.js";
import { confirmButton } from "./confirm.js";
import { LOGOS, categoryOf, displayName, filterBar, isOtherBrand } from "./image-filters.js";

const API = "/api/images";
const KEY_REASON = "The design library needs the console key (the CONSOLE_KEY value set for this console).";
const SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["name", "Name A to Z"]];
// The shirt designer picks this up on load and puts the image on the shirt.
export const ADD_TO_SHIRT = "bc-add-to-shirt";

const urlOf = (i) => i.url ?? `${API}/${encodeURIComponent(i.key)}`;
const sizeOf = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n ?? 0) / 1024))} KB`;

export async function designLibraryPage(header) {
  const head = header("Library", "Design library", "Every Elevated Designs image, saved online. Open one to rename it, change its category, show it in the shirt app or put it on a shirt.");
  const state = { items: [], other: [], sort: "new", selecting: false, picked: new Set() };
  const filters = filterBar({ onChange: () => draw(), shows: true, id: "dl" });
  const sort = el("select", { class: "field", id: "dl-sort", "aria-label": "Sort" }, SORTS.map(([v, l]) => el("option", { value: v }, l)));
  const selectBtn = el("button", { class: "btn", type: "button", id: "dl-select", "aria-pressed": "false" }, "Select");
  const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml", multiple: true, hidden: true, id: "dl-file" });
  const uploadBtn = el("button", { class: "btn primary", type: "button", id: "dl-upload", onclick: () => fileIn.click() }, "Upload");
  const count = el("p", { class: "muted small", id: "dl-count", role: "status" }, "Loading the library…");
  const grid = el("div", { class: "dl-grid", role: "list", "aria-label": "Designs" });
  const bulk = el("div", { class: "dl-bulk", hidden: true, role: "region", "aria-label": "Selected designs" });
  const otherNote = el("div", { hidden: true });
  const cats = el("datalist", { id: "dl-cats" });

  const known = () => [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort();
  const sorted = (list) => {
    const by = { new: (a, b) => (b.added ?? 0) - (a.added ?? 0), old: (a, b) => (a.added ?? 0) - (b.added ?? 0), name: (a, b) => displayName(a).localeCompare(displayName(b)) };
    return [...list].sort(by[state.sort]);
  };

  function tile(i) {
    const picked = state.picked.has(i.key);
    const t = el("button", { class: `dl-tile${picked ? " picked" : ""}`, type: "button", role: "listitem", "data-key": i.key, "aria-pressed": state.selecting ? String(picked) : null,
      onclick: () => state.selecting ? toggle(i) : openDetail(i) },
      el("span", { class: "dl-pic" }, el("img", { src: urlOf(i), alt: "", loading: "lazy", decoding: "async" })),
      el("span", { class: "dl-meta" }, el("strong", {}, displayName(i)),
        el("span", { class: "muted small" }, categoryOf(i), i.public === true ? el("span", { class: "dl-badge" }, "Shirt app") : null)),
      state.selecting ? el("span", { class: "dl-check", "aria-hidden": "true" }, picked ? "✓" : "") : null);
    return t;
  }
  function draw() {
    const shown = sorted(filters.apply(state.items));
    count.textContent = state.items.length ? `${shown.length} of ${state.items.length} images` : "No images yet. Upload some, or add them to the Kittl library folder.";
    grid.replaceChildren(...shown.map(tile));
    if (state.items.length && !shown.length) grid.append(el("p", { class: "muted" }, "Nothing matches. Try another category or search."));
    drawBulk(shown);
  }
  const toggle = (i) => { state.picked.has(i.key) ? state.picked.delete(i.key) : state.picked.add(i.key); draw(); };

  // ----- several at once -----
  function drawBulk(shown) {
    bulk.hidden = !state.selecting;
    if (!state.selecting) return;
    const n = state.picked.size;
    const catIn = el("input", { class: "field", id: "dl-bulk-cat", list: "dl-cats", placeholder: "Category name", "aria-label": "Move to category" });
    bulk.replaceChildren(
      el("strong", {}, `${n} selected`),
      el("button", { class: "btn ghost", type: "button", onclick: () => { shown.forEach((i) => state.picked.add(i.key)); draw(); } }, `Select all ${shown.length}`),
      n ? el("button", { class: "btn ghost", type: "button", onclick: () => { state.picked.clear(); draw(); } }, "Clear") : null,
      el("span", { class: "dl-bulk-acts" },
        catIn, el("button", { class: "btn", type: "button", disabled: !n, id: "dl-bulk-move", onclick: () => { const c = catIn.value.trim(); if (!c) { toast("Type a category first"); catIn.focus(); return; } patchMany({ category: c }, `Moved to ${c}`); } }, "Move"),
        el("button", { class: "btn", type: "button", disabled: !n, onclick: () => patchMany({ public: true }, "Showing in the shirt app") }, "Show in shirt app"),
        el("button", { class: "btn", type: "button", disabled: !n, onclick: () => patchMany({ public: false }, "Hidden from the shirt app") }, "Hide from shirt app"),
        n ? confirmButton(`Delete ${n}`, `Delete ${n} for good?`, () => deleteMany(), "btn danger") : null));
  }
  async function patchOne(i, patch) {
    const out = await api(`${API}/${encodeURIComponent(i.key)}`, { method: "PATCH", key: true, body: patch, reason: KEY_REASON });
    Object.assign(i, out.item);
    return i;
  }
  async function patchMany(patch, done) {
    const list = state.items.filter((i) => state.picked.has(i.key));
    let ok = 0, failed = 0;
    for (const [n, i] of list.entries()) {
      count.textContent = `Saving ${n + 1} of ${list.length}…`;
      try { await patchOne(i, patch); ok++; } catch { failed++; }
    }
    state.picked.clear(); filters.setItems(state.items); refreshCats(); draw();
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
    state.picked.clear(); filters.setItems(state.items); draw();
    toast(failed ? `${list.length - failed} deleted, ${failed} couldn't be deleted` : `Deleted ${list.length}`);
  }

  // ----- one image -----
  const dlg = el("dialog", { class: "sheet dl-sheet", id: "dl-sheet", "aria-labelledby": "dl-title" });
  function openDetail(i) {
    const name = el("input", { class: "field", id: "dl-name", maxlength: "120", value: displayName(i) === i.name ? i.name : (i.name?.startsWith("kittl-") ? "" : i.name ?? ""), placeholder: displayName(i), autocomplete: "off" });
    const cat = el("input", { class: "field", id: "dl-cat", list: "dl-cats", maxlength: "60", value: i.category ?? "", placeholder: categoryOf(i), autocomplete: "off" });
    const pub = el("input", { type: "checkbox", id: "dl-pub", checked: i.public === true });
    const save = el("button", { class: "btn primary", type: "submit", id: "dl-save" }, "Save");
    const form = el("form", { class: "stack" },
      el("label", { class: "lfield" }, el("span", {}, "Name"), name),
      el("label", { class: "lfield" }, el("span", {}, "Category"), cat, el("span", { class: "muted small" }, "Pick one or type a new one. Categories show on every image panel.")),
      el("label", { class: "row small" }, pub, "Show in the shirt app (customers can put it on a shirt)"),
      categoryOf(i) === LOGOS ? el("p", { class: "note small" }, "This is a brand logo from Kittl, so it stays private and isn't offered in List a design.") : null,
      el("div", { class: "row" }, save));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      save.disabled = true; save.textContent = "Saving…";
      const patch = { category: cat.value.trim(), public: pub.checked };
      if (name.value.trim()) patch.name = name.value.trim();
      try { await patchOne(i, patch); filters.setItems(state.items); refreshCats(); draw(); toast("Saved"); dlg.close(); }
      catch (err) { toast(err.message); save.disabled = false; save.textContent = "Save"; }
    });
    dlg.replaceChildren(
      el("div", { class: "dl-sheet-grid" },
        el("div", { class: "dl-big" }, el("img", { src: urlOf(i), alt: displayName(i) })),
        el("div", { class: "stack" },
          el("div", { class: "row", style: "justify-content:space-between;align-items:start" },
            el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "eyebrow" }, categoryOf(i)), el("h2", { id: "dl-title" }, displayName(i)),
              el("span", { class: "muted small" }, `${(i.type ?? "").replace("image/", "").toUpperCase()} · ${sizeOf(i.size)} · added ${new Date(i.added ?? Date.now()).toLocaleDateString()}`)),
            el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
          form,
          el("hr"),
          el("div", { class: "dl-acts" },
            el("button", { class: "btn", type: "button", id: "dl-shirt", onclick: () => { try { sessionStorage.setItem(ADD_TO_SHIRT, i.key); } catch { /* storage blocked */ } dlg.close(); location.hash = "#studio/ed"; } }, "Put on a shirt"),
            categoryOf(i) !== LOGOS ? el("a", { class: "btn", href: "#products/ed/list", onclick: () => dlg.close() }, "List it for sale") : null,
            el("a", { class: "btn", href: urlOf(i), download: `${displayName(i)}.${(i.type ?? "image/png").split(/[/+]/)[1].replace("jpeg", "jpg")}` }, "Download"),
            confirmButton("Delete", "Delete for good?", async () => {
              try { await deleteOne(i); filters.setItems(state.items); draw(); dlg.close(); toast("Deleted"); } catch (err) { toast(err.message); }
            }, "btn danger")))));
    dlg.showModal();
    name.focus();
  }

  // ----- upload -----
  async function upload(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const { upload: send } = await import("./studio.js");
    let ok = 0;
    for (const [n, f] of list.entries()) {
      count.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try {
        const r = await send(f, "", false);
        if (r.saved === "cloud") { state.items.unshift(r.item); ok++; }
      } catch (e) { toast(e.message); break; }
    }
    filters.setItems(state.items); draw();
    if (ok) toast(`Uploaded ${ok}. They're private until you tick Show in the shirt app.`);
  }
  fileIn.addEventListener("change", () => { upload(fileIn.files); fileIn.value = ""; });

  const refreshCats = () => cats.replaceChildren(...known().map((c) => el("option", { value: c })));
  async function load() {
    try {
      const out = await api(API, { key: true, reason: KEY_REASON });
      const all = out.items ?? [];
      state.items = all.filter((i) => !isOtherBrand(i));
      state.other = all.filter(isOtherBrand);
      filters.setItems(state.items); refreshCats(); draw();
      // Charleston 3D art stored in the Elevated Designs library: shown only so it can be cleared out.
      otherNote.hidden = !state.other.length;
      if (state.other.length) otherNote.replaceChildren(el("div", { class: "note warn small row", style: "justify-content:space-between" },
        el("span", {}, `${state.other.length} Charleston 3D image${state.other.length === 1 ? " is" : "s are"} stored in this library. They're kept out of every Elevated Designs panel.`),
        confirmButton("Remove them", "Remove for good?", async () => {
          for (const i of state.other) { try { await deleteOne(i); } catch { /* left for next time */ } }
          state.other = []; otherNote.hidden = true; toast("Charleston 3D images removed from this library");
        }, "btn")));
    } catch (e) {
      count.textContent = "";
      grid.replaceChildren(el("div", { class: "state state-error", role: "alert" }, el("strong", {}, "Couldn't load the library"), el("p", {}, e.message),
        el("button", { class: "btn", type: "button", onclick: load }, "Try again")));
    }
  }
  sort.addEventListener("change", () => { state.sort = sort.value; draw(); });
  selectBtn.addEventListener("click", () => {
    state.selecting = !state.selecting; state.picked.clear();
    selectBtn.setAttribute("aria-pressed", String(state.selecting)); selectBtn.textContent = state.selecting ? "Done" : "Select";
    draw();
  });
  if (!consoleKey.get()) count.textContent = "The design library needs the console key.";
  load();
  return [head, el("section", { class: "panel stack dl" },
    el("div", { class: "dl-top" }, filters.el, el("div", { class: "row dl-top-acts" }, sort, selectBtn, uploadBtn, fileIn)),
    otherNote, bulk, count, grid, cats), dlg];
}
