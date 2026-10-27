// Charleston 3D file library: every print file (STL, 3MF, OBJ, STEP) and its photos in one place,
// online in Cloudflare (GET/POST /api/files, lib/files.mjs), kept apart from the Elevated Designs images.
// Each STL, 3MF and OBJ gets a preview picture drawn in the browser at upload (assets/model-preview.js).
import { el, toast } from "./app.js";
import { api, askForKey, consoleKey, ApiError } from "./api.js";
import { confirmButton } from "./confirm.js";
import { canPreview, readModel, renderModel } from "./model-preview.js";

const API = "/api/files";
const ACCEPT = ".stl,.3mf,.obj,.step,.stp,.png,.jpg,.jpeg,.webp";
const MAX = 20 * 1024 * 1024;
const LABEL = { "model/stl": "STL", "model/3mf": "3MF", "model/obj": "OBJ", "model/step": "STEP", "image/png": "Photo", "image/jpeg": "Photo", "image/webp": "Photo" };
const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const date = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

async function keyOrAsk(reason) {
  return consoleKey.get() || await askForKey(reason);
}

// Sends one file, then its preview picture. Returns the saved item, or throws with a plain reason.
export async function send(file, key) {
  if (file.size > MAX) throw new Error(`${file.name} is over 20 MB.`);
  const res = await fetch(API, { method: "POST", headers: { "x-filename": file.name, "x-console-key": key, "content-type": "application/octet-stream" }, body: file });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401) { consoleKey.clear(); throw new ApiError(401, "bad_key", "Wrong or missing console key."); }
  if (!res.ok) throw new Error(out.error ?? `Couldn't save ${file.name} (${res.status}).`);
  let item = out.item;
  if (canPreview(file.name)) {
    try {
      const { canvas } = renderModel(await readModel(file.name, await file.arrayBuffer()), 480, 360);
      const png = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
      const t = await fetch(`${API}/${item.key}/thumb`, { method: "PUT", headers: { "x-console-key": key, "content-type": "image/png" }, body: png });
      if (t.ok) item = (await t.json()).item;
    } catch { /* the file is saved; it just shows without a picture */ }
  }
  return item;
}

function card(item, onDelete) {
  const isPhoto = item.type?.startsWith("image/");
  const pic = item.thumbUrl || (isPhoto ? item.url : null);
  return el("article", { class: "file-card", "data-key": item.key },
    el("div", { class: "file-pic" }, pic ? el("img", { src: pic, alt: "", loading: "lazy" })
      : el("span", { class: "file-type-big", "aria-hidden": "true" }, LABEL[item.type] ?? "FILE")),
    el("div", { class: "file-meta" },
      el("strong", { class: "file-name", title: item.name }, item.name),
      el("span", { class: "muted small" }, `${LABEL[item.type] ?? "File"} · ${size(item.size ?? 0)} · ${date(item.added ?? Date.now())}`),
      item.tags ? el("span", { class: "muted small" }, item.tags) : null),
    el("div", { class: "row file-acts" },
      el("a", { class: "btn", href: item.url, download: item.name }, "Download"),
      confirmButton("Delete", "Delete it?", () => onDelete(item))));
}

export async function filesPage(header) {
  const head = header("Library", "3D file library", "Every Charleston 3D print file and photo, saved online. STL, 3MF and OBJ files get a preview picture.");
  const grid = el("div", { class: "file-grid" });
  const status = el("p", { class: "muted", role: "status" }, "Loading files…");
  const q = el("input", { class: "field", type: "search", placeholder: "Search names and tags", "aria-label": "Search files", style: "max-width:280px" });
  const input = el("input", { type: "file", accept: ACCEPT, multiple: true, hidden: true, id: "file-in" });
  const drop = el("div", { class: "file-drop", role: "button", tabindex: "0", "aria-label": "Add files: drop them here or choose them" },
    el("strong", {}, "Drop print files or photos here"),
    el("span", { class: "muted small" }, "or click to choose · STL, 3MF, OBJ, STEP, PNG, JPG · up to 20 MB each"), input);
  let items = [];

  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const shown = items.filter((i) => !t || `${i.name} ${i.tags ?? ""}`.toLowerCase().includes(t));
    grid.replaceChildren(...shown.map((i) => card(i, remove)));
    status.textContent = !items.length ? "No files yet. Drop your first print file above." : shown.length ? `${shown.length} of ${items.length} files` : "Nothing matches.";
  };
  async function load() {
    try { items = (await api(API, { key: true, reason: "The 3D file library needs the console key (the CONSOLE_KEY value set for this console)." })).items; draw(); }
    catch (e) { status.textContent = e.message; }
  }
  async function remove(item) {
    const key = consoleKey.get();
    const res = await fetch(`${API}/${item.key}`, { method: "DELETE", headers: { "x-console-key": key } }).catch(() => null);
    if (!res?.ok) { toast("Couldn't delete it. Try again."); return; }
    items = items.filter((i) => i.key !== item.key);
    draw();
    toast(`Deleted ${item.name}`);
  }
  async function add(files) {
    const list = [...files];
    if (!list.length) return;
    const key = await keyOrAsk("Adding files needs the console key (the CONSOLE_KEY value set for this console).");
    if (!key) return;
    drop.classList.add("busy");
    let done = 0;
    const failed = [];
    for (const f of list) {
      status.textContent = `Saving ${f.name} (${done + 1} of ${list.length})…`;
      try { items.unshift(await send(f, key)); done++; draw(); }
      catch (e) { failed.push(e.message); if (e.code === "bad_key") break; }
    }
    drop.classList.remove("busy");
    draw();
    toast(failed.length ? failed[0] : `Saved ${done} file${done === 1 ? "" : "s"}`);
  }

  drop.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { add(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => add(e.dataTransfer?.files ?? []));
  q.addEventListener("input", draw);
  load();
  return [head, drop, el("div", { class: "row", style: "justify-content:space-between" }, q, status), grid];
}
