// Plate maker (Charleston3D): a license plate or plate frame with raised text, images from the design
// library and 3D flowers, previewed as lit plastic and downloaded as a multi-color 3MF or one STL.
// The base is drawn here (assets/plate-geom.js, US standard sizes and screw slots), so it needs no file.
// Images are traced into outlines (their transparency, or their dark or light parts) and raised.
// Flowers are the licensed models in assets/plates/flowers (credits in flowers.json); private STL or
// 3MF models can be added to the library too (they never show in the shirt app).
import { el, store, toast } from "./app.js";
import { askForKey, consoleKey } from "./api.js";
import { listImages, imageUrl, libraryScope } from "./studio.js";
import * as G from "./plate-geom.js";
import { createRenderer, mat, transformMesh } from "./plate-gl.js";

const FLOWERS = "assets/plates/flowers/";
const SAVE_KEY = "bc-plate-1";
const MARGIN = 14; // mm of table around the plate in the top view
// Common PLA colors (names as the filament makers use them).
const FILAMENT = [
  ["White", "#f2f1ec"], ["Ivory", "#ece2c8"], ["Silver", "#a9adb2"], ["Gray", "#6c7076"], ["Black", "#1e1f21"],
  ["Navy", "#1f2d4f"], ["Blue", "#2a5db0"], ["Teal", "#0e7c74"], ["Green", "#2f6b3c"], ["Red", "#b3262e"],
  ["Pink", "#e58fb0"], ["Purple", "#6a4a9c"], ["Orange", "#e2702b"], ["Gold", "#c9a227"], ["Brown", "#6b4a2f"],
];
const colorOf = (name) => FILAMENT.find(([n]) => n === name)?.[1] ?? name;
const nameOf = (hex) => FILAMENT.find(([, c]) => c === hex)?.[0] ?? hex;
// Lettering: open-licensed Google Fonts (free to use on products you sell).
const FONTS = [["Bebas Neue", "Plate block", 400], ["Playfair Display", "Classic serif", 700], ["Great Vibes", "Script", 400], ["Bricolage Grotesque", "Modern", 700]];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Great+Vibes&family=Playfair+Display:wght@700&display=swap";

const PLA_G_PER_MM3 = 1.24 / 1000;
const day = () => new Date().toISOString().slice(0, 10);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const uid = () => crypto.randomUUID().slice(0, 8);

// ---------- icons ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  plate: "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM6.5 8h2M15.5 8h2M7 12.5h10",
  text: "M5 6V4.5h14V6M12 4.5v15M9 19.5h6",
  library: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z",
  flower: "M12 21v-9M12 16c-2.5 0-4.5-1.2-5-3.5 2.4-.4 4.3.6 5 3.5zM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 6c0-1.6.9-3 2-3.5M12 6c0-1.6-.9-3-2-3.5",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
};
const icon = (name) => {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "ed-ico");
  s.innerHTML = `<path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};
// A small drawing of a plate style for its picker card.
function plateThumb(spec) {
  const s = document.createElementNS(SVG_NS, "svg");
  const k = 92 / spec.w, w = spec.w * k, h = spec.h * k;
  s.setAttribute("viewBox", `${-w / 2 - 4} ${-h / 2 - 4} ${w + 8} ${h + 8}`); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "pm-thumb");
  const path = (ring) => `M${ring.map(([x, y]) => `${(x * k).toFixed(1)} ${(-y * k).toFixed(1)}`).join("L")}Z`;
  const { base } = G.plateShapes(spec, { border: 0 });
  s.innerHTML = `<path d="${path(base[0].outer)}${base[0].holes.map(path).join("")}" fill-rule="evenodd" fill="currentColor" opacity=".9"/>`;
  return s;
}

// ---------- shapes for items ----------
// Every item is a unit shape: 1 wide (x), `aspect` tall (y), 1 high (z), centred on 0,0 and standing
// on z = 0. Its placement matrix scales it to the size picked, so moving or resizing never re-traces.
const shapes = new Map(); // cache key -> Promise<{ pos, aspect, outline }>
const unitFromPolys = (polys) => {
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of polys) for (const [x, y] of p.outer) { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; }
  const w = hi[0] - lo[0] || 1, cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  const fix = (ring) => ring.map(([x, y]) => [(x - cx) / w, (y - cy) / w]);
  const unit = polys.map((p) => ({ outer: fix(p.outer), holes: p.holes.map(fix) }));
  return { pos: G.extrude(unit, 0, 1), aspect: (hi[1] - lo[1]) / w, outline: unit.map((p) => p.outer) };
};
// Traces an RGBA image: "shape" uses transparency, "dark" and "light" use brightness on white.
function traceImage(data, w, h, mode, cut) {
  const a = new Uint8Array(w * h);
  let clear = 0;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] < 200) clear++;
  if (mode === "shape" && clear < w * h * 0.01) mode = "dark"; // no transparency to go by
  for (let i = 0; i < w * h; i++) {
    const al = data[i * 4 + 3] / 255;
    if (mode === "shape") { a[i] = al * 255 >= cut ? 255 : 0; continue; }
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * al + 255 * (1 - al);
    a[i] = (mode === "dark" ? lum < cut : lum >= cut && al > 0.5) ? 255 : 0;
  }
  const loops = G.maskLoops(a, w, h, { tolerance: 0.6, minArea: w * h * 0.0004 }).map((l) => l.map(([x, y]) => [x, -y]));
  const polys = G.loopsToPolys(loops);
  if (!polys.length) throw new Error("Nothing to raise in that image at this setting. Try another trace option.");
  return { ...unitFromPolys(polys), mode };
}
const loadImg = (src) => new Promise((ok, fail) => {
  const i = new Image(); i.crossOrigin = "anonymous";
  i.onload = () => ok(i); i.onerror = () => fail(new Error("That image couldn't be loaded.")); i.src = src;
});
function imageShape(it, src) {
  const k = `img|${it.ref}|${it.mode}|${it.cut}`;
  if (!shapes.has(k)) shapes.set(k, (async () => {
    const img = await loadImg(src);
    const s = 700 / Math.max(img.naturalWidth || 700, img.naturalHeight || 700);
    const w = Math.max(8, Math.round((img.naturalWidth || 700) * s)), h = Math.max(8, Math.round((img.naturalHeight || 700) * s));
    const c = Object.assign(document.createElement("canvas"), { width: w + 4, height: h + 4 });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 2, 2, w, h);
    return traceImage(g.getImageData(0, 0, w + 4, h + 4).data, w + 4, h + 4, it.mode, it.cut);
  })().catch((e) => { shapes.delete(k); throw e; }));
  return shapes.get(k);
}
let fontsLoaded;
// The stylesheet has to arrive before the fonts can be asked for, or the browser answers "none" at once.
const loadFonts = () => fontsLoaded ??= new Promise((ok) => {
  const link = el("link", { rel: "stylesheet", href: FONT_CSS });
  link.addEventListener("load", ok); link.addEventListener("error", ok);
  setTimeout(ok, 6000);
  document.head.append(link);
}).then(() => Promise.all(FONTS.map(([f, , wt]) => document.fonts.load(`${wt} 100px "${f}"`).catch(() => null))));
function textShape(it) {
  const k = `txt|${it.font}|${it.text}`;
  if (!shapes.has(k)) shapes.set(k, (async () => {
    await loadFonts();
    const [, , wt] = FONTS.find(([f]) => f === it.font) ?? FONTS[0];
    const px = 220, font = `${wt} ${px}px "${it.font}", sans-serif`;
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const m = probe.measureText(it.text);
    const pad = 40, w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2, h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2;
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.font = font; g.fillStyle = "#000";
    g.fillText(it.text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
    return traceImage(g.getImageData(0, 0, w, h).data, w, h, "shape", 128);
  })().catch((e) => { shapes.delete(k); throw e; }));
  return shapes.get(k);
}
function modelShape(it, fetchUrl, type, headers = {}) {
  const k = `mdl|${it.ref}`;
  if (!shapes.has(k)) shapes.set(k, (async () => {
    const res = await fetch(fetchUrl, { headers });
    if (!res.ok) throw new Error("That model couldn't be loaded.");
    const buf = await res.arrayBuffer();
    const raw = type === "model/3mf" || /\.3mf$/i.test(it.name ?? "") ? await G.parse3MF(buf) : G.parseSTL(buf);
    return unitModel(raw);
  })().catch((e) => { shapes.delete(k); throw e; }));
  return shapes.get(k);
}
// A model laid flat, centred, scaled to 1 wide and 1 high; aspect and its native height-to-width kept.
function unitModel(raw) {
  const { pos, size } = G.normalizeMesh(raw);
  if (size[0] <= 0 || size[1] <= 0) throw new Error("That model is flat or empty.");
  const zk = size[2] > 0 ? size[2] : 1;
  for (let i = 0; i < pos.length; i += 3) { pos[i] /= size[0]; pos[i + 1] /= size[0]; pos[i + 2] /= zk; }
  const a = size[1] / size[0];
  return { pos, aspect: a, depth: size[2] / size[0], outline: [[[-0.5, -a / 2], [0.5, -a / 2], [0.5, a / 2], [-0.5, a / 2]]] };
}

// ---------- page ----------
export async function renderPlates() {
  const saved = store.get(SAVE_KEY, null);
  const state = {
    plate: G.PLATES[saved?.plate] ? saved.plate : "us-car",
    thick: clamp(+saved?.thick || 2.4, 1.6, 4), border: clamp(+(saved?.border ?? 4), 0, 10), borderH: clamp(+saved?.borderH || 1.2, 0.4, 3),
    plateColor: saved?.plateColor ?? colorOf("White"), borderColor: saved?.borderColor ?? colorOf("Navy"),
    items: Array.isArray(saved?.items) ? saved.items.filter((i) => i && i.kind !== "upload") : [],
    sel: null, tool: "plate", view: "top", yaw: -22, pitch: 52, q: "", libs: [], models: [], flowers: [], shown: 90,
  };
  const spec = () => G.PLATES[state.plate];
  const save = () => store.set(SAVE_KEY, { plate: state.plate, thick: state.thick, border: state.border, borderH: state.borderH,
    plateColor: state.plateColor, borderColor: state.borderColor, items: state.items });
  const btn = (label, fn, cls = "btn", attrs = {}) => el("button", { class: cls, type: "button", onclick: fn, ...attrs }, label);
  const selected = () => state.items.find((i) => i.id === state.sel);
  // New text and art start in a color that shows up on the plate.
  const darkPlate = () => { const n = parseInt(state.plateColor.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 120; };
  const session = new Map(); // models picked from this computer without the key: kept for this visit only

  // ----- stage: the WebGL view and the editing overlay -----
  const canvas = el("canvas", { class: "pm-gl", "aria-hidden": "true" });
  const overlay = el("div", { class: "pm-overlay", "aria-label": "Plate. Drag items to move them." });
  const stage = el("div", { class: "pm-stage" }, canvas, overlay);
  const busy = el("div", { class: "pm-busy", hidden: true }, "Shaping…");
  stage.append(busy);
  let renderer = null;
  try { renderer = createRenderer(canvas); } catch { renderer = null; }
  if (!renderer) stage.replaceChildren(el("p", { class: "pm-nogl muted" }, "This browser can't show the 3D preview (WebGL 2 is off). Downloads still work."));
  const viewSeg = el("div", { class: "seg", role: "tablist", "aria-label": "View" });
  const dims = el("span", { class: "muted small" });
  for (const [k, label] of [["top", "Top"], ["3d", "3D"]]) viewSeg.append(el("button", { class: "seg-btn", type: "button", role: "tab", "data-view": k, "aria-selected": "false",
    onclick: () => { state.view = k; drawStage(); } }, label));

  // Built shapes for the current items, filled in as they finish tracing or loading.
  const built = new Map(); // item id -> { pos, aspect, outline, key }
  let pending = 0;
  const shapeFor = (it) => {
    if (it.kind === "text") return textShape(it);
    if (it.kind === "image") { const i = state.libs.find((x) => x.key === it.ref); return imageShape(it, i ? imageUrl(i) : it.src); }
    if (it.kind === "flower") return modelShape(it, FLOWERS + it.ref);
    if (it.kind === "model") {
      if (session.has(it.ref)) return Promise.resolve(session.get(it.ref));
      const m = state.models.find((x) => x.key === it.ref);
      if (!m) return Promise.reject(new Error(`${it.name} isn't in the library (it may have been deleted).`));
      return modelShape(it, ...modelSrc(m));
    }
    return Promise.reject(new Error("Unknown item"));
  };
  const shapeKey = (it) => `${it.kind}|${it.ref}|${it.text}|${it.font}|${it.mode}|${it.cut}`;
  async function build(it) {
    const key = shapeKey(it);
    if (built.get(it.id)?.key === key) return built.get(it.id);
    pending++; busy.hidden = false;
    try {
      const s = await shapeFor(it);
      built.set(it.id, { ...s, key });
      if (s.mode && it.kind === "image" && s.mode !== it.mode) { it.mode = s.mode; save(); }
      return s;
    } catch (e) {
      toast(e.message);
      return null;
    } finally { if (--pending === 0) busy.hidden = true; }
  }

  // ----- geometry of the plate itself -----
  let plateCache = null;
  const plateMeshes = () => {
    const key = `${state.plate}|${state.thick}|${state.border}|${state.borderH}`;
    if (plateCache?.key !== key) {
      const s = G.plateShapes(spec(), { border: state.border });
      plateCache = { key, base: G.extrude(s.base, 0, state.thick), rim: s.rim.length ? G.extrude(s.rim, state.thick, state.thick + state.borderH) : null };
    }
    return plateCache;
  };
  const itemMatrix = (it) => mat.place(it.x, it.y, state.thick, it.rot, it.w * (it.flip ? -1 : 1), it.w, it.h);
  const meshes = () => {
    const p = plateMeshes(), id = mat.identity();
    const list = [{ id: `base|${plateCache.key}`, pos: p.base, matrix: id, color: state.plateColor }];
    if (p.rim) list.push({ id: `rim|${plateCache.key}`, pos: p.rim, matrix: id, color: state.borderColor });
    for (const it of state.items) { const b = built.get(it.id); if (b) list.push({ id: `${it.id}|${b.key}`, pos: b.pos, matrix: itemMatrix(it), color: it.color }); }
    return list;
  };

  // ----- drawing -----
  const viewW = () => spec().w + 2 * MARGIN, viewH = () => spec().h + 2 * MARGIN;
  let frame = 0;
  const paint = () => {
    frame = 0;
    if (!renderer || !stage.isConnected) return;
    const s = spec(), top = state.thick + (state.border ? state.borderH : 0);
    const cam = state.view === "top" ? { mode: "top", w: viewW(), h: viewH() }
      : { mode: "3d", yaw: state.yaw, pitch: state.pitch, fov: 28, distance: Math.hypot(s.w, s.h) * 1.55, target: [0, 0, top / 2], w: s.w, h: s.h };
    renderer.draw(meshes(), cam);
  };
  const repaint = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const pct = (x, y) => [((x + viewW() / 2) / viewW()) * 100, ((viewH() / 2 - y) / viewH()) * 100];

  function drawStage() {
    const s = spec();
    stage.style.aspectRatio = `${viewW()} / ${viewH()}`;
    stage.classList.toggle("is-3d", state.view === "3d");
    viewSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    const total = state.thick + (state.border ? state.borderH : 0) + Math.max(0, ...state.items.map((i) => i.h));
    dims.textContent = `${round1(s.w)} × ${round1(s.h)} mm, ${round1(total)} mm tall`;
    overlay.replaceChildren(...(state.view === "top" ? state.items.map((it) => {
      const b = built.get(it.id), aspect = b?.aspect ?? 0.3;
      const [l, t] = pct(it.x, it.y);
      const node = el("div", { class: `layer${it.id === state.sel ? " sel" : ""}`, "data-id": it.id, title: it.name },
        el("span", { class: "handle h-size", "data-h": "size" }), el("span", { class: "handle h-rot", "data-h": "rot" }));
      Object.assign(node.style, { left: `${l - ((it.w / viewW()) * 100) / 2}%`, top: `${t - ((it.w * aspect / viewH()) * 100) / 2}%`,
        width: `${(it.w / viewW()) * 100}%`, height: `${(it.w * aspect / viewH()) * 100}%`, transform: `rotate(${-it.rot}deg)` });
      return node;
    }) : []));
    drawLayers();
    drawProps();
    repaint();
  }
  // Rebuilds what changed (tracing is cached), then redraws.
  async function refreshShapes() {
    await Promise.all(state.items.map(build));
    drawStage();
  }

  // ----- warnings: hanging off the plate, over a screw slot or the frame's window -----
  function problems(it) {
    const b = built.get(it.id);
    if (!b) return [];
    const s = spec(), m = itemMatrix(it), out = [];
    const pts = [];
    for (const ring of b.outline) for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 60))) {
      const [x, y] = ring[i];
      pts.push([m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]);
    }
    const outer = G.roundedRect(s.w, s.h, s.r);
    if (pts.some((p) => !G.pointInRing(p, outer))) out.push("Part of it hangs off the plate, so it would print in mid-air.");
    const slots = s.holes.map(([x, y]) => G.slot(x, y, s.slotLen + 2, s.slotWide + 2));
    const box = b.outline.map((r) => r.map(([x, y]) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]));
    if (slots.some((sl) => pts.some((p) => G.pointInRing(p, sl)) || box.some((r) => G.pointInRing([(sl[0][0] + sl[Math.floor(sl.length / 2)][0]) / 2, (sl[0][1] + sl[Math.floor(sl.length / 2)][1]) / 2], r))))
      out.push("It covers a screw slot. Move it so the plate can be mounted.");
    const win = G.windowRing(s);
    if (win && pts.some((p) => G.pointInRing(p, win))) out.push("Part of it is over the frame's window, where there's nothing under it.");
    return out;
  }

  // The middle of a plate, or of a frame's bottom band (between the window and the edge).
  const bandY = () => { const s = spec(); return s.window ? round1((-s.h / 2 + s.window.cy - s.window.h / 2) / 2) : 0; };

  // ----- adding items -----
  async function addItem(it) {
    const s = spec();
    const item = { id: uid(), x: 0, y: 0, rot: 0, flip: false, ...it };
    state.items.push(item);
    state.sel = item.id;
    const shape = await build(item);
    if (!shape) { state.items = state.items.filter((x) => x !== item); state.sel = null; drawStage(); return; }
    // A sensible first size: text about 2 in tall, art about a third of the plate, flowers most of its height.
    // On a frame everything goes on the bottom band, and flowers lie along it.
    const band = s.window ? s.window.cy - s.window.h / 2 + s.h / 2 - Math.max(state.border, 2) : 0;
    const lying = s.window && item.kind !== "text" && shape.aspect > 1.2;
    const want = s.window ? band * (item.kind === "text" ? 0.62 : 0.8) * (lying ? shape.aspect : 1)
      : item.kind === "text" ? Math.min(s.h * 0.3, 46) : item.kind === "image" ? s.h * 0.45 : s.h * 0.72;
    item.w = round1(clamp(want / Math.max(shape.aspect, 0.05), 6, s.w * (item.kind === "text" ? (s.window ? 0.6 : 0.52) : 0.42)));
    item.h ??= item.kind === "text" ? 1.6 : item.kind === "image" ? 1.2 : round1(clamp((shape.depth ?? 0.05) * item.w, 1, 4));
    if (s.window && item.kind === "text") item.y = bandY();
    // Flowers and art go beside the text: left first, then right (a flower there is mirrored to match).
    if (item.kind !== "text") {
      const side = (sx) => state.items.some((o) => o !== item && o.kind !== "text" && Math.sign(o.x) === sx);
      const sx = !side(-1) ? -1 : !side(1) ? 1 : 0; // both sides taken: the middle
      if (lying && sx) item.rot = sx < 0 ? 90 : -90;
      const across = lying ? item.w * shape.aspect : item.w; // its width on the plate
      item.x = round1(sx * Math.max(0, s.w / 2 - state.border - 8 - across / 2));
      item.flip = item.kind === "flower" && sx > 0;
      if (s.window) item.y = bandY();
      else if (!sx) item.y = round1(s.h / 2 - state.border - 10 - (item.w * shape.aspect) / 2);
    }
    save(); drawStage();
    if (matchMedia("(max-width: 900px)").matches) stage.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ----- tool panels -----
  const panels = {};
  const pane = (title, ...kids) => el("div", { class: "ed-pane stack" }, el("h2", {}, title), ...kids);
  const swatches = (current, on, label) => el("div", { class: "swatches", role: "group", "aria-label": label }, FILAMENT.map(([name, c]) =>
    el("button", { type: "button", title: name, "aria-label": name, "aria-pressed": String(c === current), style: `background:${c}`, onclick: () => on(c) })));

  function drawPlatePane() {
    const s = spec();
    const range = (label, min, max, step, value, unit, on) => {
      const out = el("output", {}, `${value} ${unit}`);
      const i = el("input", { type: "range", min, max, step, value, "aria-label": label });
      i.addEventListener("input", () => { on(+i.value); out.textContent = `${i.value} ${unit}`; drawStage(); });
      i.addEventListener("change", save);
      return el("label", { class: "stack small pm-range" }, el("span", { class: "row" }, label, out), i);
    };
    panels.plate = pane("Plate",
      el("span", { class: "eyebrow" }, "Base"),
      el("div", { class: "pm-styles", role: "radiogroup", "aria-label": "Base" }, Object.entries(G.PLATES).map(([k, p]) =>
        el("button", { type: "button", role: "radio", "aria-checked": String(k === state.plate),
          onclick: () => { state.plate = k; save(); drawPlatePane(); drawTool(); drawStage(); } }, plateThumb(p), el("b", {}, p.name), el("span", { class: "muted" }, p.note)))),
      range("Thickness", 1.6, 4, 0.2, state.thick, "mm", (v) => { state.thick = v; }),
      range("Raised edge", 0, 10, 0.5, state.border, "mm wide", (v) => { state.border = v; }),
      state.border ? range("Edge height", 0.4, 3, 0.2, state.borderH, "mm", (v) => { state.borderH = v; }) : null,
      el("span", { class: "eyebrow" }, `Plate color: ${nameOf(state.plateColor)}`),
      swatches(state.plateColor, (c) => { state.plateColor = c; save(); drawPlatePane(); drawTool(); repaint(); }, "Plate color"),
      state.border ? el("span", { class: "eyebrow" }, `Edge color: ${nameOf(state.borderColor)}`) : null,
      state.border ? swatches(state.borderColor, (c) => { state.borderColor = c; save(); drawPlatePane(); drawTool(); repaint(); }, "Edge color") : null,
      el("p", { class: "muted small" }, s.window
        ? "Screws go through the frame and the plate's own holes. Keep text on the bottom band."
        : "Screw slots match the US standard pattern, with room to line up with any car's holes."),
      btn("Download blank base (3MF)", () => exportFile("3mf", true), "btn"));
  }

  const textIn = el("input", { class: "field", type: "text", maxlength: 40, placeholder: "e.g. CHARLESTON", "aria-label": "Text" });
  let textFont = FONTS[0][0];
  const fontList = el("div", { class: "pm-fonts", role: "radiogroup", "aria-label": "Font" });
  const drawFonts = () => fontList.replaceChildren(...FONTS.map(([f, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(f === textFont),
    onclick: () => { textFont = f; drawFonts(); const s = selected(); if (s?.kind === "text") { s.font = f; save(); refreshShapes(); } } },
    el("span", { class: "pm-font", style: `font-family:"${f}"` }, "Charleston"), el("span", { class: "muted small" }, label))));
  const addText = () => {
    const t = textIn.value.trim();
    if (!t) return textIn.focus();
    addItem({ kind: "text", text: t, font: textFont, name: t, color: colorOf(darkPlate() ? "White" : "Navy") });
    textIn.value = "";
  };
  textIn.addEventListener("keydown", (e) => { if (e.key === "Enter") addText(); });
  panels.text = pane("Text", textIn, fontList, btn("Add text", addText, "btn primary"),
    el("p", { class: "muted small" }, "Letters are raised 1.6 mm by default. Change size, height and color on the right."));

  const search = el("input", { class: "field", type: "search", placeholder: "Search images by name or tag", "aria-label": "Search images" });
  const lib = el("div", { class: "lib", role: "list" });
  const libNote = el("p", { class: "muted small" });
  const more = btn("Show more", () => { state.shown += 90; drawLib(); }, "btn ghost", { hidden: true });
  search.addEventListener("input", () => { state.q = search.value; state.shown = 90; drawLib(); });
  const drawLib = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = state.libs.filter((i) => words.every((w) => `${i.name} ${i.tags ?? ""} ${i.category ?? ""}`.toLowerCase().includes(w)));
    lib.replaceChildren(...shown.slice(0, state.shown).map((i) => el("div", { class: "lib-item", role: "listitem" },
      el("button", { class: "tile", type: "button", title: `${i.name}\nClick to add it to the plate`,
        onclick: () => addItem({ kind: "image", ref: i.key, src: i.local ? null : imageUrl(i), name: i.name, mode: "shape", cut: 128, color: colorOf(darkPlate() ? "White" : "Black") }) },
        el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" }), el("span", { class: "nm" }, i.name)))));
    more.hidden = shown.length <= state.shown;
    libNote.replaceChildren(...[`${shown.length} of ${state.libs.length} images.`,
      libraryScope === "public" ? el("span", {}, " ", btn("Show private images too", unlock, "linkbtn")) : null].filter(Boolean));
    if (!shown.length) lib.append(el("p", { class: "muted small" }, state.libs.length ? "No images match that search." : "No images yet. Add them in the Design Studio."));
  };
  panels.library = pane("Images", search, libNote, lib, more,
    el("p", { class: "muted small" }, "Images are traced into raised shapes. Logos and line art with a transparent background work best; photos don't."));

  const flowerGrid = el("div", { class: "lib pm-models", role: "list" });
  const modelGrid = el("div", { class: "lib pm-models", role: "list" });
  const modelIn = el("input", { type: "file", accept: ".stl,.3mf,model/stl,model/3mf", hidden: true });
  const creditsList = el("details", { class: "pm-credits small" }, el("summary", {}, "Where the flowers come from"));
  panels.flower = pane("Flowers", flowerGrid,
    el("h3", {}, "Your models"), modelGrid,
    btn("Add an STL or 3MF", () => modelIn.click(), "btn ghost"), modelIn,
    el("p", { class: "muted small" }, "Models are pressed flat to the height you pick, so flat-backed ones work best. Saved models stay private."),
    creditsList);

  const layersList = el("div", { class: "layers" });
  panels.layers = pane("Layers", el("p", { class: "muted small" }, "Select one to edit it."), layersList);
  const kindLabel = { text: "Text", image: "Image", flower: "Flower", model: "Model" };
  const drawLayers = () => {
    layersList.replaceChildren(...[...state.items].reverse().map((it) => el("button", { type: "button", "aria-pressed": String(it.id === state.sel),
      onclick: () => { state.sel = it.id; state.view = "top"; drawStage(); } },
      el("span", { class: "pm-dot", style: `background:${it.color}` }), el("span", {}, `${kindLabel[it.kind]}: ${it.name}`))));
    if (!state.items.length) layersList.append(el("p", { class: "muted small" }, "Nothing on the plate yet."));
  };

  const paneHost = el("div", { class: "ed-panel" });
  const rail = el("nav", { class: "ed-rail", "aria-label": "Plate tools" },
    [["plate", "Plate"], ["text", "Text"], ["library", "Images"], ["flower", "Flowers"], ["layers", "Layers"]].map(([k, label]) =>
      el("button", { type: "button", "data-tool": k, "aria-pressed": "false", onclick: () => { state.tool = k; drawTool(); } }, icon(k), el("span", {}, label))));
  function drawTool() {
    rail.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === state.tool)));
    if (state.tool === "plate") drawPlatePane();
    if (state.tool === "text") drawFonts();
    if (state.tool === "flower") drawModels();
    paneHost.replaceChildren(panels[state.tool]);
  }

  // ----- flowers and models: tiles drawn by the same renderer, from above -----
  let thumbR = null;
  const thumbCanvas = el("canvas", { class: "pm-thumbgl" });
  const thumbs = new Map();
  async function thumb(key, shapeP, color) {
    if (thumbs.has(key)) return thumbs.get(key);
    const p = (async () => {
      const s = await shapeP;
      if (!thumbR) { document.body.append(thumbCanvas); thumbR = createRenderer(thumbCanvas); }
      if (!thumbR) return null;
      const box = Math.max(1, s.aspect) * 1.12;
      thumbR.draw([{ id: key, pos: s.pos, matrix: mat.place(0, 0, 0, 0, 1, 1, Math.min(0.08, s.depth ?? 0.05)), color }], { mode: "top", w: box, h: box, radius: box });
      return thumbCanvas.toDataURL("image/png");
    })().catch(() => null);
    thumbs.set(key, p);
    return p;
  }
  const modelTile = (name, key, shapeP, color, onAdd, extra) => {
    const img = el("img", { alt: name });
    thumb(key, shapeP, color).then((src) => { if (src) img.src = src; else img.replaceWith(el("span", { class: "pm-noimg" }, "3D")); });
    return el("div", { class: "lib-item", role: "listitem" },
      el("button", { class: "tile", type: "button", title: `${name}\nClick to add it to the plate`, onclick: onAdd }, img, el("span", { class: "nm" }, name)), extra);
  };
  function drawModels() {
    flowerGrid.replaceChildren(...state.flowers.map((f) => modelTile(f.name, `f|${f.file}`, modelShape({ ref: f.file, name: f.file }, FLOWERS + f.file), colorOf(f.color),
      () => addItem({ kind: "flower", ref: f.file, name: f.name, color: colorOf(f.color) }))));
    const mine = [...state.models.map((m) => ({ m, p: () => modelShape({ ref: m.key, name: m.name }, ...modelSrc(m)) })),
      ...[...session.entries()].map(([k, s]) => ({ m: { key: k, name: s.name, session: true }, p: () => Promise.resolve(s) }))];
    modelGrid.replaceChildren(...mine.map(({ m, p }) => modelTile(m.name, `m|${m.key}`, p(), colorOf("Teal"),
      () => addItem({ kind: "model", ref: m.key, name: m.name.replace(/\.(stl|3mf)$/i, ""), color: colorOf("Teal") }),
      m.session ? null : el("button", { class: "lib-del", type: "button", "aria-label": `Delete ${m.name}`, title: "Delete from the library", onclick: () => delModel(m) }, "×"))));
    if (!mine.length) modelGrid.append(el("p", { class: "muted small" }, libraryScope === "all" ? "None yet." : "Saved models need the console key. ",
      libraryScope === "all" ? null : btn("Show them", unlock, "linkbtn")));
    creditsList.replaceChildren(creditsList.firstChild, el("ul", {}, state.flowers.map((f) =>
      el("li", {}, el("b", {}, f.name), ": ", el("a", { href: f.source, target: "_blank", rel: "noopener" }, f.title), ` by ${f.author}, ${f.license}.`))),
      el("p", { class: "muted" }, "All allow selling prints. For CC BY models, credit the author on the product page."));
  }
  // A saved model's file: the signed link the list hands out, or the file with the key.
  const modelSrc = (m) => m.url ? [m.url, m.type] : [`/api/images/${encodeURIComponent(m.key)}`, m.type, { "x-console-key": consoleKey.get() }];
  async function loadModels() {
    state.models = [];
    if (libraryScope !== "all" || !consoleKey.get()) return;
    try {
      const res = await fetch("/api/images?models=1", { headers: { accept: "application/json", "x-console-key": consoleKey.get() } });
      if (res.ok) state.models = (await res.json()).items ?? [];
    } catch { /* offline */ }
  }
  modelIn.addEventListener("change", async () => {
    const f = modelIn.files[0]; modelIn.value = "";
    if (!f) return;
    const type = /\.3mf$/i.test(f.name) ? "model/3mf" : /\.stl$/i.test(f.name) ? "model/stl" : null;
    if (!type) return toast("Pick an .stl or .3mf file");
    if (f.size > 20 * 1024 * 1024) return toast("That model is larger than 20 MB");
    let shape;
    try { const buf = await f.arrayBuffer(); shape = unitModel(type === "model/3mf" ? await G.parse3MF(buf) : G.parseSTL(buf)); }
    catch (e) { return toast(e.message || "That model couldn't be read"); }
    if (consoleKey.get() || await askForKey("Saving models to the library needs the console key. Cancel to use it for this visit only.")) {
      try {
        const res = await fetch("/api/images", { method: "POST", body: f, headers: { "content-type": type, "x-filename": f.name, "x-console-key": consoleKey.get() } });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error ?? `Upload failed (${res.status})`);
        shapes.set(`mdl|${out.item.key}`, Promise.resolve(shape));
        await listImages(); await loadModels();
        toast("Model saved to the library (private)");
        drawModels();
        return;
      } catch (e) { toast(`${e.message}. Using it for this visit only.`); }
    }
    session.set(`s-${uid()}`, { ...shape, name: f.name });
    drawModels();
  });
  async function delModel(m) {
    if (!confirm(`Delete "${m.name}" from the library?`)) return;
    try {
      const res = await fetch(`/api/images/${encodeURIComponent(m.key)}`, { method: "DELETE", headers: { "x-console-key": consoleKey.get() } });
      if (!res.ok) throw new Error(`Couldn't delete (${res.status})`);
      state.models = state.models.filter((x) => x !== m);
      drawModels(); toast("Model deleted");
    } catch (e) { toast(e.message); }
  }
  async function unlock() {
    if (!(await askForKey("Private images and models need the console key (the CONSOLE_KEY value set for this console)."))) return;
    state.libs = await listImages(); await loadModels();
    drawLib(); drawModels();
  }

  // ----- properties (right) -----
  const props = el("div", { class: "ed-props stack" });
  function drawProps() {
    const it = selected();
    if (!it) return drawPlateProps();
    const b = built.get(it.id), aspect = b?.aspect ?? 0;
    const num = (label, value, min, max, step, unit, on) => {
      const i = el("input", { class: "field pm-num", type: "number", min, max, step, value: round1(value), "aria-label": label });
      const r = el("input", { type: "range", min, max, step, value, "aria-label": label });
      const set = (v) => { if (!Number.isFinite(v)) return; v = clamp(v, min, max); on(v); i.value = round1(v); r.value = v; drawStage(); };
      r.addEventListener("input", () => set(+r.value));
      i.addEventListener("change", () => set(+i.value));
      r.addEventListener("change", save); i.addEventListener("change", save);
      return el("label", { class: "stack small pm-range" }, el("span", { class: "row" }, label, el("span", { class: "pm-unit" }, i, unit)), r);
    };
    const warn = problems(it);
    props.replaceChildren(...[
      el("h2", {}, kindLabel[it.kind]),
      it.kind === "text" ? (() => {
        const t = el("input", { class: "field", type: "text", maxlength: 40, value: it.text, "aria-label": "Text" });
        t.addEventListener("change", () => { const v = t.value.trim(); if (v) { it.text = v; it.name = v; save(); refreshShapes(); } });
        return t;
      })() : el("p", { class: "muted small ed-name" }, it.name),
      it.kind === "text" ? el("select", { class: "field", "aria-label": "Font", onchange: (e) => { it.font = e.target.value; save(); refreshShapes(); } },
        FONTS.map(([f, label]) => el("option", { value: f, selected: f === it.font }, `${label} (${f})`))) : null,
      it.kind === "image" ? el("div", { class: "stack", style: "gap:6px" },
        el("span", { class: "eyebrow" }, "Raise"),
        el("div", { class: "seg pm-seg", role: "radiogroup", "aria-label": "What to raise" }, [["shape", "Shape"], ["dark", "Dark"], ["light", "Light"]].map(([k, label]) =>
          el("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": String(it.mode === k), "aria-pressed": String(it.mode === k),
            onclick: () => { it.mode = k; save(); refreshShapes(); } }, label))),
        num("Detail cut-off", it.cut, 20, 235, 5, "", (v) => { it.cut = v; }))
        : null,
      num("Width", it.w, 4, Math.round(spec().w), 0.5, "mm", (v) => { it.w = v; }),
      el("p", { class: "muted small" }, aspect ? `${round1(it.w)} × ${round1(it.w * aspect)} mm` : ""),
      num("Raised", it.h, 0.4, 8, 0.1, "mm", (v) => { it.h = v; }),
      num("Rotation", it.rot, -180, 180, 1, "°", (v) => { it.rot = v; }),
      el("span", { class: "eyebrow" }, `Color: ${nameOf(it.color)}`),
      swatches(it.color, (c) => { it.color = c; save(); drawStage(); }, "Color"),
      el("div", { class: "ed-grid2" },
        btn("Center", () => edit((s) => { s.x = 0; })), btn(spec().window ? "Bottom band" : "Middle", () => edit((s) => { s.y = bandY(); })),
        btn("Flip", () => edit((s) => { s.flip = !s.flip; })), btn("Duplicate", dup)),
      ...warn.map((w) => el("p", { class: "pm-warn small", role: "note" }, w)),
      btn("Remove from plate", delItem, "btn danger"),
      el("hr"), exportBlock()].filter(Boolean));
  }
  function drawPlateProps() {
    props.replaceChildren(el("h2", {}, "Your plate"),
      el("p", { class: "muted small" }, state.items.length ? "Select something on the plate to size, raise, turn or color it." : "Add text, an image or a flower from the tools on the left. Drag to move; the corner dot resizes and the top dot turns."),
      el("hr"), exportBlock());
  }
  function exportBlock() {
    const vol = estimate();
    const credits = creditsUsed();
    return el("div", { class: "stack", style: "gap:8px" },
      el("h3", {}, "Download"),
      btn("Download 3MF (each color its own part)", () => exportFile("3mf"), "btn primary"),
      btn("Download STL (one color)", () => exportFile("stl"), "btn"),
      el("p", { class: "muted small" }, `About ${Math.round(vol * PLA_G_PER_MM3)} g of PLA. The 3MF opens in Bambu Studio, Orca and PrusaSlicer as one object, ready to pick a filament per part.`),
      credits.length ? el("p", { class: "muted small" }, "Credit on the product page: ", credits.join("; "), ".") : null);
  }
  const creditsUsed = () => [...new Set(state.items.filter((i) => i.kind === "flower").map((i) => state.flowers.find((f) => f.file === i.ref))
    .filter((f) => f && !/^CC0/.test(f.license)).map((f) => `${f.name} by ${f.author} (${f.license.split(" (")[0]}, ${f.source})`))];
  const estimate = () => {
    const p = plateMeshes();
    let v = G.meshVolume(p.base) + (p.rim ? G.meshVolume(p.rim) : 0);
    for (const it of state.items) { const b = built.get(it.id); if (b) v += Math.abs(G.meshVolume(b.pos)) * it.w * it.w * it.h; }
    return v;
  };

  const edit = (fn) => { const s = selected(); if (s) { fn(s); save(); drawStage(); } };
  const dup = () => edit((s) => { const c = { ...s, id: uid(), x: s.x + 8, y: s.y - 8 }; state.items.push(c); built.set(c.id, built.get(s.id)); state.sel = c.id; });
  const delItem = () => edit((s) => { state.items = state.items.filter((x) => x !== s); built.delete(s.id); state.sel = null; });

  // ----- moving, resizing and turning on the top view -----
  overlay.addEventListener("pointerdown", (e) => {
    const node = e.target.closest(".layer");
    if (!node) { if (state.sel) { state.sel = null; drawStage(); } return; }
    const it = state.items.find((x) => x.id === node.dataset.id);
    if (state.sel !== it.id) { state.sel = it.id; drawStage(); }
    const box = overlay.getBoundingClientRect(), k = viewW() / box.width; // mm per pixel
    const mode = e.target.dataset.h ?? "move";
    const start = { px: e.clientX, py: e.clientY, x: it.x, y: it.y, w: it.w };
    const [lp, tp] = pct(it.x, it.y);
    const cx = box.left + (lp / 100) * box.width, cy = box.top + (tp / 100) * box.height;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const move = (ev) => {
      if (mode === "move") { it.x = round1(start.x + (ev.clientX - start.px) * k); it.y = round1(start.y - (ev.clientY - start.py) * k); }
      else if (mode === "size") it.w = round1(clamp(start.w * (Math.hypot(ev.clientX - cx, ev.clientY - cy) / startDist), 4, spec().w));
      else {
        let r = -Math.round((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        it.rot = ((r + 540) % 360) - 180;
      }
      drawStage();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); save(); drawStage(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  });
  // Orbit the 3D view by dragging.
  canvas.addEventListener("pointerdown", (e) => {
    if (state.view !== "3d") return;
    const s = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => { state.yaw = s.yaw - (ev.clientX - s.x) * 0.4; state.pitch = clamp(s.pitch + (ev.clientY - s.y) * 0.3, 8, 89); repaint(); };
    const up = () => { canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
  const onKey = (e) => {
    if (!document.body.contains(stage)) return document.removeEventListener("keydown", onKey);
    if (!selected() || state.view !== "top" || e.target.closest("input, textarea, select, dialog")) return;
    const step = e.shiftKey ? 5 : 1;
    const map = { Delete: delItem, Backspace: delItem, ArrowLeft: () => edit((s) => { s.x -= step; }), ArrowRight: () => edit((s) => { s.x += step; }),
      ArrowUp: () => edit((s) => { s.y += step; }), ArrowDown: () => edit((s) => { s.y -= step; }) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  document.addEventListener("keydown", onKey);
  new ResizeObserver(repaint).observe(stage);

  // ----- export -----
  async function exportFile(kind, blank = false) {
    await Promise.all(state.items.map(build));
    const p = plateMeshes(), s = spec();
    const parts = [{ name: s.window ? "Frame" : "Plate", color: state.plateColor, colorName: nameOf(state.plateColor), pos: p.base }];
    if (p.rim) parts.push({ name: "Raised edge", color: state.borderColor, colorName: nameOf(state.borderColor), pos: p.rim });
    if (!blank) for (const it of state.items) {
      const b = built.get(it.id);
      if (b) parts.push({ name: `${kindLabel[it.kind]}: ${it.name}`.slice(0, 80), color: it.color, colorName: nameOf(it.color), pos: transformMesh(b.pos, itemMatrix(it)) });
    }
    const words = blank ? s.name : state.items.find((i) => i.kind === "text")?.text ?? s.name;
    const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plate";
    const title = blank ? `${s.name} blank` : `${s.name}: ${words}`;
    let data, type, name;
    if (kind === "3mf") {
      data = await G.write3MF({ title, parts });
      type = "model/3mf"; name = `${slug}${blank ? "-blank" : ""}-${day()}.3mf`;
    } else {
      data = G.writeSTL(parts.map((x) => x.pos), title);
      type = "model/stl"; name = `${slug}-${day()}.stl`;
    }
    const a = el("a", { href: URL.createObjectURL(new Blob([data], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`${name} downloaded: ${parts.length} part${parts.length === 1 ? "" : "s"}, ${round1(s.w)} × ${round1(s.h)} mm`);
  }

  // ----- page -----
  const page = el("div", { class: "editor pm" },
    rail, paneHost,
    el("section", { class: "ed-canvas", "aria-label": "Plate" },
      el("div", { class: "ed-bar pm-bar" }, viewSeg, dims), stage,
      el("p", { class: "muted small ed-hint" }, "Top view: drag to move, the corner dot resizes, the top dot turns (Shift snaps). 3D view: drag to look around.")),
    el("aside", { class: "ed-side", "aria-label": "Properties" }, props));

  const [libs, flowers] = await Promise.all([listImages().catch(() => []), fetch(`${FLOWERS}../flowers.json`).then((r) => r.json()).catch(() => [])]);
  state.libs = libs.filter((i) => (i.type ?? "").startsWith("image/") || !i.type);
  state.flowers = flowers;
  await loadModels();
  drawLib();
  drawTool();
  drawStage();
  refreshShapes();
  return page;
}
