// Charleston 3D's 3D maker: drop 1 to 4 photos of one thing, or describe it in words, and Meshy makes a
// printable model (lib/meshy.mjs, Aaron's Meshy credits). Finished models turn in a 3D view, download as
// STL, 3MF or GLB, and save into the 3D file library with one click.
import { el, toast } from "./app.js";
import { api, askForKey, consoleKey, ApiError } from "./api.js";
import { confirmButton } from "./confirm.js";
import { readModel, renderModel } from "./model-preview.js";

const API = "/api/meshy";
const KEY_REASON = "The 3D maker needs the console key (the CONSOLE_KEY value set for this console).";
const MAX_PHOTOS = 4;
const MAX_SIDE = 1600; // photos are made smaller before they go, so four fit in one request
const POLL_MS = 5000;
const DONE = new Set(["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED", "NOKEY"]);
const cost = ({ mode, color, detail }) => (mode === "words" || !color ? 20 : 30) + (detail === "high" ? 5 : 0);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const hoursLeft = (exp) => Math.max(0, Math.floor((exp - Date.now()) / 3600000));

// A finished file through the console (the Meshy key stays on the server), as bytes.
async function fetchFile(path) {
  let k = consoleKey.get() || await askForKey(KEY_REASON);
  if (!k) throw new ApiError(0, "cancelled", "No console key entered.");
  const res = await fetch(path, { headers: { "x-console-key": k } }).catch(() => null);
  if (!res) throw new ApiError(0, "offline", "Couldn't reach the console. Check your connection.");
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) consoleKey.clear();
    throw new ApiError(res.status, out.code ?? "error", out.error ?? `Error ${res.status}`);
  }
  return res.arrayBuffer();
}
const saveAs = (buf, name) => {
  const a = el("a", { href: URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

// A photo made at most 1600 px on its longest side; PNGs stay PNG (a clear background helps Meshy).
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = el("canvas", { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
}

// ---------- 3D view (three.js from tools/vendor, loaded the first time a model is opened) ----------
let threeLib;
const loadScript = (src) => new Promise((ok, fail) => {
  const s = el("script", { src });
  s.onload = ok; s.onerror = () => fail(new Error(`${src} didn't load`));
  document.head.append(s);
});
const loadThree = () => threeLib ??= loadScript("tools/vendor/three.min.js")
  .then(() => loadScript("tools/vendor/OrbitControls.js")).then(() => window.THREE)
  .catch((e) => { threeLib = null; throw e; });

function viewer(host) {
  let stop = () => {};
  return {
    async show(parts) {
      stop();
      const THREE = await loadThree();
      const W = host.clientWidth || 600, H = host.clientHeight || 420;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      renderer.setSize(W, H);
      const scene = new THREE.Scene();
      const sky = new THREE.HemisphereLight(0xffffff, 0x8a8170, 0.9); sky.position.set(0, 0, 1); scene.add(sky);
      const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(1, -1.2, 1.6); scene.add(sun);
      const group = new THREE.Group();
      for (const p of parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(p.tri, 3));
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0e7c74, roughness: 0.55, metalness: 0.05 })));
      }
      const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);
      scene.add(group);
      const r = Math.max(size.x, size.y, size.z) || 1;
      // STL files are Z-up, the way Bambu Studio lays them on the plate.
      const cam = new THREE.PerspectiveCamera(35, W / H, r / 100, r * 100);
      cam.up.set(0, 0, 1);
      cam.position.set(r * 1.5, -r * 1.7, r * 0.9);
      const controls = new THREE.OrbitControls(cam, renderer.domElement);
      controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
      controls.addEventListener("start", () => { controls.autoRotate = false; });
      renderer.domElement.setAttribute("aria-label", "3D view of the model. Drag to turn it, scroll or pinch to zoom.");
      renderer.domElement.setAttribute("role", "img");
      host.replaceChildren(renderer.domElement);
      let raf = 0;
      const tick = () => { if (!renderer.domElement.isConnected) { stop(); return; } controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(tick); };
      tick();
      const ro = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (w && h) { renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); } });
      ro.observe(host);
      stop = () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); stop = () => {}; };
    },
    clear(node) { stop(); host.replaceChildren(node); },
  };
}

export async function meshyPage(header) {
  const head = header("Make", "3D maker", "Photos or a few words in, a printable model out. Made by Meshy with your Meshy credits.");
  const state = { mode: "photos", photos: [], color: false, detail: "standard", jobs: [], selected: null, configured: true, balance: null };

  // ---------- left: what to make ----------
  const modeSeg = el("div", { class: "seg", role: "group", "aria-label": "Make it from" });
  const photoIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true, id: "m3d-photos" });
  const thumbs = el("div", { class: "m3d-thumbs" });
  const drop = el("div", { class: "file-drop m3d-drop", role: "button", tabindex: "0", "aria-label": "Add photos: drop them here or choose them" },
    el("strong", {}, "Drop 1 to 4 photos of one thing"),
    el("span", { class: "muted small" }, "Different sides of the same object work best · PNG, JPG or WebP"), photoIn);
  const photoBox = el("div", { class: "stack" }, drop, thumbs);
  const prompt = el("textarea", { class: "field", rows: 4, maxlength: 800, id: "m3d-prompt", placeholder: "e.g. a pineapple Christmas ornament with a hanging loop, smooth surface, flat base" });
  const wordsBox = el("div", { class: "stack", hidden: true },
    el("label", { for: "m3d-prompt", class: "small" }, "Describe the model"), prompt,
    el("p", { class: "muted small" }, "Words make the shape first (20 credits). Add color after it's done for 10 more."));
  const name = el("input", { class: "field", id: "m3d-name", maxlength: 80, placeholder: "Name it, e.g. Pineapple ornament" });
  const colorSeg = el("div", { class: "seg", role: "group", "aria-label": "Color" });
  const detailSeg = el("div", { class: "seg", role: "group", "aria-label": "Detail" });
  const colorRow = el("div", { class: "m3d-opt" }, el("span", { class: "small" }, "Finish"), colorSeg);
  const detailRow = el("div", { class: "m3d-opt" }, el("span", { class: "small" }, "Detail"), detailSeg);
  const startBox = el("div");
  const credits = el("p", { class: "muted small", role: "status" });
  const setup = el("div", { class: "note warn", hidden: true },
    el("strong", {}, "Add your Meshy key to turn this on. "),
    "On your PC, in the business-console folder, run ", el("code", {}, "npx wrangler secret put MESHY_API_KEY"),
    " and paste the key from meshy.ai › API. It stays in Cloudflare, never in the console.");
  const form = el("section", { class: "panel m3d-form", "aria-label": "Make a model" },
    el("div", { class: "panel-head" }, el("h3", {}, "New model"), modeSeg),
    setup, photoBox, wordsBox,
    el("label", { for: "m3d-name", class: "small" }, "Name"), name,
    colorRow, detailRow, startBox, credits);

  // ---------- right: the selected model and the list ----------
  const stage = el("div", { class: "m3d-stage" });
  const stageInfo = el("div", { class: "m3d-stage-info" });
  const stageActs = el("div", { class: "row m3d-acts" });
  const view3d = viewer(stage);
  const list = el("div", { class: "m3d-list", role: "list", "aria-label": "Your models" });
  const listNote = el("p", { class: "muted small" });
  const right = el("div", { class: "stack m3d-right" },
    el("section", { class: "panel m3d-view", "aria-label": "Model" }, stage, stageInfo, stageActs),
    el("section", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", {}, "Your models"), listNote), list));

  const segButtons = (seg, opts, get, set) => {
    seg.replaceChildren(...opts.map(([v, label]) => el("button", { type: "button", class: "seg-btn", "aria-pressed": String(get() === v), onclick: () => { set(v); drawForm(); } }, label)));
  };
  function drawForm() {
    segButtons(modeSeg, [["photos", "From photos"], ["words", "From words"]], () => state.mode, (v) => { state.mode = v; });
    segButtons(colorSeg, [[false, "Plain (for printing)"], [true, "With color"]], () => state.color, (v) => { state.color = v; });
    segButtons(detailSeg, [["standard", "Standard"], ["high", "High (+5)"]], () => state.detail, (v) => { state.detail = v; });
    photoBox.hidden = state.mode !== "photos";
    wordsBox.hidden = state.mode !== "words";
    colorRow.hidden = state.mode !== "photos";
    setup.hidden = state.configured;
    thumbs.replaceChildren(...state.photos.map((p, i) => el("figure", { class: "m3d-thumb" },
      el("img", { src: p.url, alt: `Photo ${i + 1}` }),
      el("button", { type: "button", class: "m3d-x", "aria-label": `Remove photo ${i + 1}`, onclick: () => { state.photos.splice(i, 1); drawForm(); } }, "×"))));
    const c = cost(state);
    const ready = state.configured && (state.mode === "photos" ? state.photos.length > 0 : prompt.value.trim().length >= 3);
    const btn = ready ? confirmButton(`Make 3D model · ${c} credits`, `Click again to spend ${c} credits`, start, "btn primary m3d-go")
      : el("button", { type: "button", class: "btn primary m3d-go", disabled: true }, `Make 3D model · ${c} credits`);
    startBox.replaceChildren(btn);
    credits.textContent = state.balance != null ? `${state.balance} Meshy credits left` : state.configured ? "Meshy credits: checking…" : "";
  }
  prompt.addEventListener("input", () => { const go = startBox.querySelector("button"); if (go?.disabled !== (prompt.value.trim().length < 3)) drawForm(); });

  async function addPhotos(files) {
    const fs = [...files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!fs.length) { toast("Add PNG, JPG or WebP photos."); return; }
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) { toast("Up to 4 photos. Remove one first."); return; }
    if (fs.length > room) toast(`Only the first ${room} added (4 photos at most).`);
    for (const f of fs.slice(0, room)) {
      try { state.photos.push({ url: await shrink(f), name: f.name }); } catch { toast(`Couldn't read ${f.name}.`); }
    }
    if (!name.value.trim()) name.value = fs[0].name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 80);
    drawForm();
  }
  drop.addEventListener("click", (e) => { if (e.target !== photoIn) photoIn.click(); });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); photoIn.click(); } });
  photoIn.addEventListener("change", () => { addPhotos(photoIn.files); photoIn.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => addPhotos(e.dataTransfer?.files ?? []));

  async function start() {
    const body = { mode: state.mode, name: name.value.trim() || (state.mode === "words" ? prompt.value.trim().slice(0, 60) : "3D model"), color: state.color, detail: state.detail,
      ...(state.mode === "photos" ? { images: state.photos.map((p) => p.url) } : { prompt: prompt.value.trim() }) };
    try {
      const { job } = await api(`${API}/jobs`, { method: "POST", body, key: true, reason: KEY_REASON });
      state.jobs.unshift(job);
      state.photos = []; prompt.value = ""; name.value = "";
      if (state.balance != null) state.balance = Math.max(0, state.balance - job.cost);
      select(job.id);
      drawForm(); drawList(); poll();
      toast("Started. Models take about 2 to 5 minutes.");
    } catch (e) { toast(e.message); }
  }

  // ---------- the list and the selected model ----------
  const statusText = (j) => j.status === "SUCCEEDED" ? (j.saved ? "Saved to library" : "Ready")
    : j.status === "FAILED" ? "Didn't work" : j.status === "EXPIRED" ? "Expired" : j.status === "NOKEY" ? "Needs the Meshy key"
    : j.status === "PENDING" ? (j.queue ? `Waiting (${j.queue} ahead)` : "Waiting") : j.status === "IN_PROGRESS" ? `Making… ${j.progress}%` : "Checking…";
  function drawList() {
    listNote.textContent = state.jobs.length ? "Meshy keeps models 3 days. Save the ones you want." : "";
    if (!state.jobs.length) { list.replaceChildren(el("p", { class: "muted" }, "Nothing made yet. Your models show up here.")); return; }
    list.replaceChildren(...state.jobs.map((j) => {
      const pic = j.status === "SUCCEEDED" && j.picture ? el("img", { alt: "", loading: "lazy", "data-pic": j.id }) : el("span", { class: "m3d-ph", "aria-hidden": "true" }, j.kind === "words" ? "Aa" : "◰");
      const row = el("button", { type: "button", role: "listitem", class: "m3d-row", "aria-current": String(state.selected === j.id), onclick: () => select(j.id) },
        el("span", { class: "m3d-pic" }, pic),
        el("span", { class: "m3d-meta" }, el("strong", {}, j.name),
          el("span", { class: "muted small" }, `${j.kind === "words" ? "From words" : j.kind === "photo" ? "From 1 photo" : "From photos"}${j.color ? " · color" : ""} · ${j.cost} credits · ${ago(j.created)}`)),
        el("span", { class: `pill m3d-st st-${(j.status ?? "").toLowerCase()}` }, statusText(j)));
      if (!DONE.has(j.status)) row.append(el("span", { class: "m3d-bar", "aria-hidden": "true" }, el("span", { style: `width:${Math.max(4, j.progress ?? 0)}%` })));
      return row;
    }));
    list.querySelectorAll("img[data-pic]").forEach(async (img) => {
      try { img.src = URL.createObjectURL(new Blob([await fetchFile(`${API}/jobs/${img.dataset.pic}/file/picture`)])); } catch { img.replaceWith(el("span", { class: "m3d-ph" }, "◰")); }
    });
  }

  let shown = null;
  async function drawStage() {
    const j = state.jobs.find((x) => x.id === state.selected);
    if (!j) {
      view3d.clear(el("div", { class: "m3d-empty" }, el("strong", {}, "Your model shows here"), el("span", { class: "muted small" }, "Turn it, zoom in, then download it for Bambu Studio or save it to the 3D file library.")));
      stageInfo.replaceChildren(); stageActs.replaceChildren(); shown = null; return;
    }
    stageInfo.replaceChildren(el("h3", {}, j.name), el("p", { class: "muted small" },
      j.prompt ? `"${j.prompt}" · ` : "", `${j.cost} credits`, j.expiresAt && j.status === "SUCCEEDED" && !j.saved ? ` · Meshy deletes it in ${hoursLeft(j.expiresAt)} h` : ""));
    if (j.status !== "SUCCEEDED") {
      shown = null;
      view3d.clear(el("div", { class: "m3d-empty" }, j.status === "FAILED"
        ? [el("strong", {}, "Meshy couldn't make this one"), el("span", { class: "muted small" }, j.error || "No credits were used. Try clearer photos or a simpler description.")]
        : j.status === "EXPIRED" ? [el("strong", {}, "This model has expired"), el("span", { class: "muted small" }, "Meshy keeps models for 3 days.")]
        : [el("strong", {}, statusText(j)), el("span", { class: "m3d-bar big", "aria-hidden": "true" }, el("span", { style: `width:${Math.max(4, j.progress ?? 0)}%` })), el("span", { class: "muted small" }, "Usually 2 to 5 minutes. You can leave this page; it keeps going.")]));
      stageActs.replaceChildren(confirmButton("Remove from list", "Click again to remove", () => remove(j)));
      return;
    }
    const dl = (fmt, label, cls = "btn") => el("button", { type: "button", class: cls, onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { saveAs(await fetchFile(`${API}/jobs/${j.id}/file/${fmt}`), `${j.name}.${fmt}`); } catch (err) { toast(err.message); }
      finally { b.disabled = false; } } }, label);
    stageActs.replaceChildren(...[
      j.formats?.includes("3mf") ? dl("3mf", "Download 3MF", "btn primary") : null,
      j.formats?.includes("stl") ? dl("stl", "Download STL") : null,
      j.formats?.includes("glb") ? dl("glb", "Download GLB") : null,
      j.saved ? el("a", { class: "btn ghost", href: "#files/c3d" }, "Open in 3D file library")
        : el("button", { type: "button", class: "btn ghost", onclick: (e) => save(j, e.currentTarget) }, "Save to 3D file library"),
      j.kind === "words" && !j.color ? confirmButton("Add color · 10 credits", "Click again to spend 10 credits", () => addColor(j)) : null,
      confirmButton("Remove from list", "Click again to remove", () => remove(j))].filter(Boolean));
    if (shown === j.id) return;
    shown = j.id;
    view3d.clear(el("div", { class: "m3d-empty" }, el("span", { class: "muted small" }, "Loading the model…")));
    try {
      const parts = await readModel("model.stl", await fetchFile(`${API}/jobs/${j.id}/file/stl`));
      if (state.selected === j.id) await view3d.show(parts);
    } catch (e) {
      if (state.selected === j.id) view3d.clear(el("div", { class: "m3d-empty" }, el("span", { class: "muted small" }, `Couldn't show the model: ${e.message}`)));
    }
  }
  function select(id) { state.selected = id; drawList(); drawStage(); }

  async function save(j, btn) {
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const { item } = await api(`${API}/jobs/${j.id}/save`, { method: "POST", body: { format: j.formats.includes("3mf") ? "3mf" : "stl" }, key: true, reason: KEY_REASON });
      j.saved = item.key;
      // a preview picture for the library card, drawn from the STL like an upload's
      try {
        const { canvas } = renderModel(await readModel("m.stl", await fetchFile(`${API}/jobs/${j.id}/file/stl`)), 480, 360);
        const png = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
        await fetch(`/api/files/${item.key}/thumb`, { method: "PUT", headers: { "x-console-key": consoleKey.get(), "content-type": "image/png" }, body: png });
      } catch { /* saved; it just shows without a picture */ }
      toast(`Saved ${item.name} to the 3D file library`);
      drawList(); drawStage();
    } catch (e) { toast(e.message); if (btn.isConnected) { btn.disabled = false; btn.textContent = "Save to 3D file library"; } }
  }
  async function addColor(j) {
    try {
      const { job } = await api(`${API}/jobs/${j.id}/color`, { method: "POST", key: true, reason: KEY_REASON });
      state.jobs.unshift(job); select(job.id); poll();
    } catch (e) { toast(e.message); }
  }
  async function remove(j) {
    try {
      await api(`${API}/jobs/${j.id}`, { method: "DELETE", key: true, reason: KEY_REASON });
      state.jobs = state.jobs.filter((x) => x.id !== j.id);
      if (state.selected === j.id) state.selected = state.jobs[0]?.id ?? null;
      drawList(); drawStage();
    } catch (e) { toast(e.message); }
  }

  // Unfinished jobs are checked every few seconds while this page is open.
  let timer = null;
  async function refresh(j) {
    try {
      const { job } = await api(`${API}/jobs/${j.id}`, { key: true, reason: KEY_REASON });
      Object.assign(j, job);
    } catch (e) { if (e.code === "meshy_gone") Object.assign(j, { status: "EXPIRED" }); else if (e.status === 401 || e.code === "cancelled") throw e; }
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!list.isConnected) return;
      const open = state.jobs.filter((j) => !DONE.has(j.status));
      if (!open.length) return;
      await Promise.all(open.map(refresh)).catch(() => null);
      drawList();
      if (open.some((j) => j.id === state.selected)) drawStage();
      poll();
    }, POLL_MS);
  }

  async function load() {
    try {
      const out = await api(API, { key: true, reason: KEY_REASON });
      state.configured = out.configured; state.balance = out.balance;
      state.jobs = out.jobs.map((j) => ({ ...j, status: out.configured ? undefined : "NOKEY" }));
      drawForm(); drawList();
      if (state.configured && state.jobs.length) {
        await Promise.all(state.jobs.slice(0, 12).map(refresh)).catch(() => null);
        state.jobs.slice(12).forEach((j) => { if (Date.now() - j.created > 3 * 86400000) j.status = "EXPIRED"; });
        state.selected ??= (state.jobs.find((j) => j.status === "SUCCEEDED") ?? state.jobs[0]).id;
      }
      drawList(); drawStage(); poll();
    } catch (e) { listNote.textContent = ""; list.replaceChildren(el("p", { class: "muted" }, e.message)); drawStage(); }
  }

  drawForm(); drawList(); drawStage(); load();
  return [head, el("div", { class: "m3d" }, form, right)];
}
