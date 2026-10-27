// Charleston 3D's 3D generator: drop in a photo (up to four views of one object) or describe the model,
// and Meshy makes it (lib/meshy.mjs, /api/meshy). Finished models download as STL, 3MF, GLB or OBJ, or go
// straight into the 3D file library with a preview picture. The Meshy key stays in the Worker.
import { el, toast } from "./app.js";
import { api, consoleKey, askForKey } from "./api.js";
import { confirmButton } from "./confirm.js";
import { send } from "./files.js";

const API = "/api/meshy";
const MAX_PHOTOS = 4;
const LONG_SIDE = 1600;
const KEY_REASON = "The 3D generator needs the console key (the CONSOLE_KEY value set for this console).";
const DONE = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const STATUS = { PENDING: "Waiting in line", IN_PROGRESS: "Making", SUCCEEDED: "Ready", FAILED: "Failed", CANCELED: "Canceled" };
const KIND = { preview: "Shape from a description", refine: "Coloured model", image: "From a photo", multi: "From photos" };
const date = (t) => t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

// A photo, made smaller in the browser so it uploads quickly (Meshy needs no more than this).
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name} isn't a PNG, JPG or WebP photo.`);
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, LONG_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const g = c.getContext("2d");
  // PNGs keep their transparency; photos go as JPEG.
  const png = file.type === "image/png";
  if (!png) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL(png ? "image/png" : "image/jpeg", 0.9);
}

// Puts a finished model into the 3D file library: 3MF when Meshy made one (smaller), otherwise STL.
async function saveToLibrary(item) {
  const fmt = item.files["3mf"] ? "3mf" : item.files.stl ? "stl" : null;
  if (!fmt) throw new Error("This model has no STL or 3MF to save.");
  const key = consoleKey.get() || await askForKey("Saving to the 3D file library needs the console key.");
  if (!key) return null;
  const res = await fetch(item.files[fmt]);
  if (!res.ok) throw new Error("Couldn't fetch the model from Meshy. Try again.");
  const base = (item.prompt || KIND[item.mode] || "meshy model").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "meshy model";
  const file = new File([await res.blob()], `${base}.${fmt}`, { type: "application/octet-stream" });
  return send(file, key);
}

function card(item, actions) {
  const busy = !DONE.has(item.status);
  const pct = Math.max(2, Math.min(100, item.progress || 0));
  const label = KIND[item.mode] ?? "Model";
  const formats = ["stl", "3mf", "glb", "obj"].filter((f) => item.files?.[f]);
  return el("article", { class: "file-card gen-card", "data-id": item.id },
    el("div", { class: "file-pic" }, item.thumbUrl ? el("img", { src: item.thumbUrl, alt: item.prompt || label, loading: "lazy" })
      : el("span", { class: "file-type-big", "aria-hidden": "true" }, busy ? `${item.progress || 0}%` : "3D")),
    el("div", { class: "file-meta" },
      el("strong", { class: "file-name", title: item.prompt || label }, item.prompt || label),
      el("span", { class: "muted small" }, [item.prompt ? label : null, date(item.created), item.credits != null && item.status === "SUCCEEDED" ? `${item.credits} credits` : null].filter(Boolean).join(" · ")),
      busy ? el("div", { class: "gen-progress", role: "progressbar", "aria-valuenow": String(item.progress || 0), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": STATUS[item.status] },
        el("span", { style: `width:${pct}%` })) : null,
      el("span", { class: `small gen-status s-${item.status}` },
        item.status === "FAILED" ? `Failed${item.error ? `: ${item.error}` : ""} (credits refunded)`
          : item.queue != null ? `${STATUS[item.status]} · ${item.queue} ahead` : STATUS[item.status] ?? item.status)),
    item.status === "SUCCEEDED" ? el("div", { class: "row file-acts" },
      formats.map((f) => el("a", { class: "btn", href: item.files[f], download: "" }, f.toUpperCase())),
      actions.save(item), item.mode === "preview" ? actions.refine(item) : null) : null);
}

export async function generate3dPage(header) {
  const head = header("Make", "3D generator", "Drop in a photo of an object, or describe it, and Meshy builds a printable model. Download it for Bambu Studio or save it to the 3D file library.");
  const account = el("p", { class: "muted small", role: "status" }, "Checking Meshy…");
  const grid = el("div", { class: "file-grid brand-c3d" });
  const listStatus = el("p", { class: "muted", role: "status" }, "Loading your models…");

  // ---------- what to make ----------
  let mode = "photo";
  let photos = []; // { name, data }
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Make it from" });
  const tabs = [["photo", "From a photo"], ["text", "From a description"]].map(([id, label]) =>
    el("button", { class: "seg-btn", type: "button", "aria-pressed": String(id === mode), onclick: () => { mode = id; drawForm(); } }, label));
  seg.append(...tabs);

  const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true });
  const thumbs = el("div", { class: "gen-photos" });
  const drop = el("div", { class: "file-drop", role: "button", tabindex: "0", "aria-label": "Add photos: drop them here or choose them" },
    el("strong", {}, "Drop a photo of the object here"),
    el("span", { class: "muted small" }, `or click to choose · up to ${MAX_PHOTOS} views of the same object (front, side, back) · PNG, JPG or WebP`), input);
  const prompt = el("textarea", { class: "field gen-prompt", rows: "3", maxlength: "800", placeholder: "" });
  const promptLabel = el("label", { class: "stack gen-label" });
  const colour = el("input", { type: "checkbox" });
  const colourRow = el("label", { class: "row small" }, colour, el("span", {}, "Add colour (texture). Leave off for single-colour prints."));
  const go = confirmButton("Make the 3D model", "Uses Meshy credits. Make it?", () => create(), "btn primary");

  function drawForm() {
    tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(["photo", "text"][i] === mode)));
    const photo = mode === "photo";
    drop.hidden = !photo; thumbs.hidden = !photo; colourRow.hidden = !photo;
    promptLabel.replaceChildren(
      el("span", { class: "small" }, photo ? "Notes for the colour (optional)" : "Describe the model"), prompt);
    prompt.placeholder = photo ? "Matte black body, brass details" : "A low chess knight with a flat base, about 5 cm tall";
    promptLabel.hidden = photo && !colour.checked;
    thumbs.replaceChildren(...photos.map((p, i) => el("figure", { class: "gen-photo" },
      el("img", { src: p.data, alt: p.name }),
      el("button", { class: "btn ghost small", type: "button", "aria-label": `Remove ${p.name}`, onclick: () => { photos.splice(i, 1); drawForm(); } }, "Remove"))));
  }
  colour.addEventListener("change", drawForm);

  async function addPhotos(files) {
    for (const f of [...files]) {
      if (photos.length >= MAX_PHOTOS) { toast(`Up to ${MAX_PHOTOS} photos of one object.`); break; }
      try { photos.push({ name: f.name, data: await shrink(f) }); }
      catch (e) { toast(e.message); }
    }
    drawForm();
  }
  drop.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { addPhotos(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => addPhotos(e.dataTransfer?.files ?? []));

  // ---------- the models ----------
  let items = [];
  const actions = {
    save: (item) => {
      const b = el("button", { class: "btn brand", type: "button" }, "Save to file library");
      b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "Saving…";
        try { const saved = await saveToLibrary(item); if (saved) { toast(`Saved ${saved.name} to the 3D file library`); b.textContent = "Saved"; return; } }
        catch (e) { toast(e.message); }
        b.disabled = false; b.textContent = "Save to file library";
      });
      return b;
    },
    refine: (item) => confirmButton("Add colour", "Uses Meshy credits. Add colour?", async () => {
      await start({ kind: "refine", previewId: item.id });
    }),
  };
  const draw = () => {
    grid.replaceChildren(...items.map((i) => card(i, actions)));
    listStatus.textContent = items.length ? `${items.length} model${items.length === 1 ? "" : "s"}` : "No models yet. Make your first one above.";
  };

  async function refreshBalance() {
    try {
      const out = await api(API, { key: true, reason: KEY_REASON });
      if (!out.configured) { account.textContent = out.error; go.disabled = true; return false; }
      account.textContent = out.balance != null ? `Meshy connected · ${out.balance.toLocaleString()} credits left` : "Meshy connected";
      go.disabled = false;
      return true;
    } catch (e) { account.textContent = e.message; return false; }
  }

  // Unfinished models are asked about again every few seconds while this page is open.
  let timer = null;
  function watch() {
    clearTimeout(timer);
    const open = items.filter((i) => !DONE.has(i.status));
    if (!open.length) return;
    timer = setTimeout(async () => {
      if (!grid.isConnected) return;
      for (const i of open) {
        try {
          const { item } = await api(`${API}/tasks/${i.kind}/${i.id}`, { key: true, reason: KEY_REASON });
          const at = items.findIndex((x) => x.id === item.id);
          if (at >= 0) items[at] = item;
          if (item.status === "SUCCEEDED") { toast("Your 3D model is ready."); refreshBalance(); }
        } catch { /* asked again next round */ }
      }
      draw();
      watch();
    }, 8000);
  }

  async function start(body) {
    try {
      const { item } = await api(`${API}/tasks`, { method: "POST", body, key: true, reason: KEY_REASON });
      items.unshift({ ...item, mode: body.kind === "refine" ? "refine" : item.kind === "text" ? "preview" : item.kind, created: Date.now() });
      draw(); watch();
      toast("Meshy is making it. This usually takes a few minutes; you can leave this page.");
      return true;
    } catch (e) { toast(e.message); return false; }
  }

  async function create() {
    const text = prompt.value.trim();
    if (mode === "photo") {
      if (!photos.length) { toast("Add a photo of the object first."); return; }
      if (await start({ kind: "image", images: photos.map((p) => p.data), texture: colour.checked, prompt: colour.checked ? text : "" })) { photos = []; prompt.value = ""; drawForm(); }
    } else {
      if (text.length < 3) { toast("Describe the model in a few words."); prompt.focus(); return; }
      if (await start({ kind: "text", prompt: text })) { prompt.value = ""; }
    }
  }

  async function load() {
    if (!(await refreshBalance())) { listStatus.textContent = ""; return; }
    try { items = (await api(`${API}/tasks`, { key: true, reason: KEY_REASON })).items; draw(); watch(); }
    catch (e) { listStatus.textContent = e.message; }
  }

  drawForm();
  load();
  return [head,
    el("section", { class: "panel brand-c3d" },
      el("div", { class: "panel-head" }, seg, account),
      drop, thumbs, colourRow, promptLabel,
      el("div", { class: "row" }, go,
        el("span", { class: "muted small" }, "A shape from a description can get colour added afterwards. Failed models are refunded."))),
    el("div", { class: "row", style: "justify-content:space-between" }, el("h2", {}, "Your models"), listStatus),
    grid];
}
