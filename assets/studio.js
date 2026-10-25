// Design Studio: an online image library plus a drag-and-drop shirt designer.
// Images live in Netlify Blobs through /api/images, so the PC can stay off.
// If that API can't be reached (opened as plain files, or not deployed yet), images are kept in this browser instead.
import { el, store, toast } from "./app.js";
import { consoleKey } from "./api.js";

const API = "/api/images";
const PRINT_W = 4500; // 15 in at 300 dpi
const PRINT_H = 5400; // 18 in at 300 dpi
const COLORS = [
  ["White", "#f4f4f2"], ["Black", "#1c1c1e"], ["Heather grey", "#a7a9ac"], ["Navy", "#1f2a44"],
  ["Red", "#b3262e"], ["Forest", "#2f4a34"], ["Sand", "#d9c7a3"], ["Maroon", "#5b1f2a"], ["Royal", "#2a4fa0"],
];

// ---------- storage ----------
const keyHeader = () => { const k = consoleKey.get(); return k ? { "x-console-key": k } : {}; };

let localDb;
const db = () => localDb ??= new Promise((ok, fail) => {
  const req = indexedDB.open("bc-images", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("images", { keyPath: "key" });
  req.onsuccess = () => ok(req.result);
  req.onerror = () => fail(req.error);
});
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction("images", mode);
    const r = fn(t.objectStore("images"));
    t.oncomplete = () => ok(r?.result);
    t.onerror = () => fail(t.error);
  });
};
const localUrls = new Map();

async function listLocal() {
  try {
    const rows = (await tx("readonly", (s) => s.getAll())) ?? [];
    return rows.map(({ blob, ...m }) => {
      if (!localUrls.has(m.key)) localUrls.set(m.key, URL.createObjectURL(blob));
      return { ...m, local: true };
    });
  } catch { return []; }
}

export async function listImages() {
  let cloud = [];
  try {
    const res = await fetch(API, { headers: { accept: "application/json" } });
    if (res.ok && res.headers.get("content-type")?.includes("json")) cloud = (await res.json()).items ?? [];
  } catch { /* offline or not deployed */ }
  const local = await listLocal();
  return [...cloud, ...local].sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
}

export const imageUrl = (item) => item.local ? localUrls.get(item.key) : `${API}/${encodeURIComponent(item.key)}`;

async function upload(file, tags) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": file.type, "x-filename": file.name, "x-tags": tags, ...keyHeader() },
      body: file,
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(res.status === 401 ? "Wrong or missing console key. Add it under Settings below." : "Uploads are off until CONSOLE_KEY is set for this console."), { stop: true });
    if (res.ok) return { saved: "cloud", item: (await res.json()).item };
    if (res.status === 413 || res.status === 415) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? res.statusText), { stop: true });
  } catch (e) { if (e.stop) throw e; }
  const item = { key: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name, type: file.type, size: file.size, tags, added: Date.now() };
  await tx("readwrite", (s) => s.put({ ...item, blob: file }));
  return { saved: "local", item };
}

async function remove(item) {
  if (item.local) {
    await tx("readwrite", (s) => s.delete(item.key));
    URL.revokeObjectURL(localUrls.get(item.key));
    localUrls.delete(item.key);
    return;
  }
  const res = await fetch(`${API}/${encodeURIComponent(item.key)}`, { method: "DELETE", headers: keyHeader() });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong or missing console key." : "Couldn't delete that image.");
}

// ---------- shirt artwork ----------
const SVG_NS = "http://www.w3.org/2000/svg";
function shirtSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "shirt");
  svg.setAttribute("viewBox", "0 0 500 600");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <path class="body" d="M165 40 L120 55 L20 120 L60 215 L110 190 L110 570 Q250 585 390 570 L390 190 L440 215 L480 120 L380 55 L335 40 Q250 95 165 40 Z"
      stroke="rgba(0,0,0,.25)" stroke-width="2"/>
    <path d="M165 40 Q250 95 335 40 Q250 70 165 40 Z" fill="rgba(0,0,0,.12)"/>
    <path d="M110 190 L110 230 M390 190 L390 230" stroke="rgba(0,0,0,.12)" stroke-width="2"/>`;
  return svg;
}

// ---------- page ----------
export async function renderStudio() {
  const saved = store.get("bc-design", null);
  const state = { color: saved?.color ?? COLORS[0][1], layers: saved?.layers ?? [], sel: null, items: [], q: "" };
  const save = () => store.set("bc-design", { color: state.color, layers: state.layers });

  // library column
  const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", multiple: true, hidden: true });
  const tagsIn = el("input", { class: "field", type: "text", placeholder: "Tags for new uploads, e.g. halloween, logo" });
  const drop = el("div", { class: "drop" }, "Drop images here or ",
    el("button", { class: "btn ghost", type: "button", onclick: () => fileIn.click() }, "choose files"));
  const search = el("input", { class: "field", type: "search", placeholder: "Search by name or tag", "aria-label": "Search images" });
  const countLine = el("p", { class: "muted small" });
  const lib = el("div", { class: "lib", role: "list" });

  // stage column
  const svg = shirtSvg();
  const area = el("div", { class: "print-area" });
  const stage = el("div", { class: "stage" }, svg, area);
  const layersList = el("div", { class: "layers" });
  const sizeIn = el("input", { type: "range", min: 5, max: 150, value: 50 });
  const rotIn = el("input", { type: "range", min: -180, max: 180, value: 0 });
  const opIn = el("input", { type: "range", min: 10, max: 100, value: 100 });
  const swatches = el("div", { class: "swatches" });
  const guide = el("input", { type: "checkbox", checked: true });
  const keyIn = el("input", { class: "field", type: "password", placeholder: "The CONSOLE_KEY value", autocomplete: "off", value: consoleKey.get() });

  // ----- library -----
  const drawLib = () => {
    const q = state.q.toLowerCase();
    const shown = state.items.filter((i) => !q || `${i.name} ${i.tags ?? ""}`.toLowerCase().includes(q));
    const localCount = state.items.filter((i) => i.local).length;
    countLine.textContent = `${shown.length} of ${state.items.length} images` +
      (localCount ? `. ${localCount} saved only in this browser.` : ".");
    lib.replaceChildren(...shown.map((i) => {
      const b = el("button", { type: "button", draggable: "true", title: `${i.name}${i.tags ? ` · ${i.tags}` : ""}\nClick to add, or drag onto the shirt`,
        onclick: () => addLayer(i), role: "listitem" },
        el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" }), el("span", { class: "nm" }, i.name));
      b.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/bc-image", i.key));
      b.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        if (!confirm(`Delete "${i.name}" from the library?`)) return;
        try { await remove(i); state.items = state.items.filter((x) => x !== i); drawLib(); toast("Image deleted"); }
        catch (err) { toast(err.message); }
      });
      return b;
    }));
    if (!shown.length) lib.append(el("p", { class: "muted small" }, state.items.length ? "No images match that search." : "No images yet. Upload some to start your catalog."));
  };
  const refresh = async () => { state.items = await listImages(); drawLib(); };

  const uploadFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    let cloud = 0, local = 0, failed = 0;
    for (const [n, f] of list.entries()) {
      countLine.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try { (await upload(f, tagsIn.value.trim())).saved === "cloud" ? cloud++ : local++; }
      catch (e) { failed++; toast(e.message); if (e.message.includes("key")) break; }
    }
    await refresh();
    toast([cloud && `${cloud} saved online`, local && `${local} saved in this browser only`, failed && `${failed} failed`].filter(Boolean).join(", "));
  };
  fileIn.addEventListener("change", () => { uploadFiles(fileIn.files); fileIn.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles(e.dataTransfer.files); });
  search.addEventListener("input", () => { state.q = search.value; drawLib(); });

  // ----- layers -----
  const findItem = (key) => state.items.find((i) => i.key === key);
  const layerSrc = (l) => { const i = findItem(l.key); return i ? imageUrl(i) : null; };

  function addLayer(item, x = 0.5, y = 0.4) {
    const img = new Image();
    img.onload = () => {
      const w = 0.6, ratio = img.naturalHeight / img.naturalWidth || 1;
      const h = w * ratio * (PRINT_W / PRINT_H);
      state.layers.push({ id: crypto.randomUUID(), key: item.key, name: item.name, x, y, w, h, rot: 0, op: 1 });
      state.sel = state.layers.at(-1).id;
      drawStage(); save();
    };
    img.onerror = () => toast("Couldn't load that image");
    img.src = imageUrl(item);
  }
  const selected = () => state.layers.find((l) => l.id === state.sel);

  function drawStage() {
    svg.querySelector(".body").setAttribute("fill", state.color);
    area.classList.toggle("hide-guide", !guide.checked);
    area.replaceChildren(...state.layers.map((l) => {
      const src = layerSrc(l);
      const node = el("div", { class: `layer${l.id === state.sel ? " sel" : ""}`, "data-id": l.id },
        src ? el("img", { src, alt: l.name }) : el("span", { class: "muted small" }, "Missing image"),
        el("span", { class: "handle h-size", "data-h": "size" }), el("span", { class: "handle h-rot", "data-h": "rot" }));
      Object.assign(node.style, {
        left: `${(l.x - l.w / 2) * 100}%`, top: `${(l.y - l.h / 2) * 100}%`,
        width: `${l.w * 100}%`, height: `${l.h * 100}%`,
        transform: `rotate(${l.rot}deg)`, opacity: l.op,
      });
      return node;
    }));
    layersList.replaceChildren(...[...state.layers].reverse().map((l) =>
      el("button", { type: "button", "aria-pressed": String(l.id === state.sel), onclick: () => { state.sel = l.id; drawStage(); } },
        layerSrc(l) ? el("img", { src: layerSrc(l), alt: "" }) : null, el("span", {}, l.name))));
    if (!state.layers.length) layersList.append(el("p", { class: "muted small" }, "Click or drag an image from the library to put it on the shirt."));
    const s = selected();
    [sizeIn, rotIn, opIn].forEach((i) => (i.disabled = !s));
    if (s) { sizeIn.value = Math.round(s.w * 100); rotIn.value = Math.round(s.rot); opIn.value = Math.round(s.op * 100); }
    swatches.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === state.color)));
  }

  // drag, resize and rotate with one pointer handler
  area.addEventListener("pointerdown", (e) => {
    const node = e.target.closest(".layer");
    if (!node) { state.sel = null; drawStage(); return; }
    const l = state.layers.find((x) => x.id === node.dataset.id);
    state.sel = l.id; drawStage();
    const box = area.getBoundingClientRect();
    const mode = e.target.dataset.h ?? "move";
    const start = { px: e.clientX, py: e.clientY, ...l };
    const cx = box.left + l.x * box.width, cy = box.top + l.y * box.height;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const move = (ev) => {
      if (mode === "move") {
        l.x = start.x + (ev.clientX - start.px) / box.width;
        l.y = start.y + (ev.clientY - start.py) / box.height;
      } else if (mode === "size") {
        const k = Math.max(0.05, Math.hypot(ev.clientX - cx, ev.clientY - cy) / startDist);
        l.w = Math.max(0.03, start.w * k); l.h = Math.max(0.03, start.h * k);
      } else {
        l.rot = Math.round((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
        if (ev.shiftKey) l.rot = Math.round(l.rot / 15) * 15;
      }
      drawStage();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); save(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  });
  stage.addEventListener("dragover", (e) => e.preventDefault());
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    const box = area.getBoundingClientRect();
    const key = e.dataTransfer.getData("text/bc-image");
    if (key && findItem(key)) return addLayer(findItem(key), (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  const editSel = (fn) => { const s = selected(); if (s) { fn(s); drawStage(); save(); } };
  sizeIn.addEventListener("input", () => editSel((s) => { const k = sizeIn.value / 100 / s.w; s.w *= k; s.h *= k; }));
  rotIn.addEventListener("input", () => editSel((s) => (s.rot = +rotIn.value)));
  opIn.addEventListener("input", () => editSel((s) => (s.op = opIn.value / 100)));
  const reorder = (d) => editSel((s) => {
    const i = state.layers.indexOf(s), j = i + d;
    if (j < 0 || j >= state.layers.length) return;
    [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
  });
  const dup = () => editSel((s) => { const c = { ...s, id: crypto.randomUUID(), x: s.x + 0.04, y: s.y + 0.04 }; state.layers.push(c); state.sel = c.id; });
  const del = () => editSel((s) => { state.layers = state.layers.filter((x) => x !== s); state.sel = null; });
  const center = () => editSel((s) => { s.x = 0.5; });
  const nudge = (dx, dy) => editSel((s) => { s.x += dx; s.y += dy; });

  const onKey = (e) => {
    if (!document.body.contains(stage)) return document.removeEventListener("keydown", onKey);
    if (!selected() || e.target.closest("input, textarea, select")) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const map = { Delete: del, Backspace: del, ArrowLeft: () => nudge(-step, 0), ArrowRight: () => nudge(step, 0),
      ArrowUp: () => nudge(0, -step), ArrowDown: () => nudge(0, step) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  document.addEventListener("keydown", onKey);

  COLORS.forEach(([name, c]) => swatches.append(el("button", { type: "button", title: name, "aria-label": name, "data-c": c,
    style: `background:${c}`, onclick: () => { state.color = c; drawStage(); save(); } })));
  guide.addEventListener("change", drawStage);
  keyIn.addEventListener("change", () => { consoleKey.set(keyIn.value.trim()); toast("Console key kept for this browser tab"); });

  // ----- export -----
  async function exportPng() {
    if (!state.layers.length) return toast("Add an image to the shirt first");
    const c = Object.assign(document.createElement("canvas"), { width: PRINT_W, height: PRINT_H });
    const g = c.getContext("2d");
    for (const l of state.layers) {
      const src = layerSrc(l);
      if (!src) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      try { await img.decode(); } catch { toast(`Skipped ${l.name}, it couldn't be loaded`); continue; }
      g.save();
      g.globalAlpha = l.op;
      g.translate(l.x * PRINT_W, l.y * PRINT_H);
      g.rotate((l.rot * Math.PI) / 180);
      g.drawImage(img, (-l.w * PRINT_W) / 2, (-l.h * PRINT_H) / 2, l.w * PRINT_W, l.h * PRINT_H);
      g.restore();
    }
    c.toBlob((blob) => {
      const a = el("a", { href: URL.createObjectURL(blob), download: `shirt-design-${new Date().toISOString().slice(0, 10)}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Print file downloaded: 4500 × 5400 px, 15 × 18 in at 300 dpi");
    }, "image/png");
  }

  const btn = (label, fn, cls = "btn") => el("button", { class: cls, type: "button", onclick: fn }, label);
  const page = el("div", { class: "studio" },
    el("section", { class: "panel stack", "aria-label": "Image library" },
      el("div", { class: "panel-head" }, el("h2", {}, "Image library"), btn("Upload", () => fileIn.click(), "btn primary")),
      drop, fileIn, tagsIn, search, countLine, lib,
      el("p", { class: "muted small" }, "Right-click an image to delete it.")),
    el("section", { class: "stage-wrap", "aria-label": "Shirt designer" },
      el("div", { class: "panel" }, stage),
      el("div", { class: "panel controls" },
        el("div", { class: "panel-head" }, el("h2", {}, "Design"), btn("Download print file", exportPng, "btn primary")),
        el("label", {}, "Shirt color", swatches),
        el("label", {}, "Size", sizeIn), el("label", {}, "Rotation", rotIn), el("label", {}, "Opacity", opIn),
        el("div", { class: "row" },
          btn("Center", center), btn("Forward", () => reorder(1)), btn("Back", () => reorder(-1)),
          btn("Duplicate", dup), btn("Remove", del),
          btn("Clear shirt", () => { if (confirm("Remove every image from the shirt?")) { state.layers = []; state.sel = null; drawStage(); save(); } }, "btn ghost")),
        el("label", { class: "row" }, guide, "Show print area guide"),
        el("h3", {}, "Layers, top first"), layersList,
        el("details", {}, el("summary", {}, "Settings"), el("label", {}, "Console key", keyIn)),
        el("p", { class: "muted small" }, "Drag to move, the corner dot resizes, the top dot rotates (hold Shift to snap). Arrow keys nudge, Delete removes."))));

  await refresh();
  drawStage();
  return page;
}
