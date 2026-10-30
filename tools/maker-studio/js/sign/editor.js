// Sign maker editor: dark tool bar on top (Text, Icon, Shape, SVG, Hole | Plate, Thickness), edit tools
// down the left, 2D/3D + zoom + settings + Download top right, a floating panel on the right, and the
// canvas in the middle with rulers in mm. Everything edits one document; every change can be undone.
import { $, h, icon, toast, pickFile, pathD, fmt, UNITS, slug } from "../ui.js";
import { FONTS, registerFont, UM, bounds, offset } from "../geom.js";
import { FILAMENTS, filament } from "../print.js";
import { Preview } from "../preview.js";
import { stl, threeMF, download } from "../export.js";
import { buildSign, elementLocal, flipForPrint, loadIcons, BORDER_WEIGHTS } from "./build.js";
import { PLATE_STYLES, plateOutline, SHAPES, shapeOutline } from "./shapes.js";
import { blank, uid, TEMPLATES, HOLE_PRESETS, HOLE_SIZES, presetHoles, projects } from "./model.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const TIPS = {
  text: ["Add text", "Several colours, fonts and sizes."], icon: ["Add icon", "Hundreds of icons, outline or solid."],
  shape: ["Add shape", "Square, triangle, circle or star."], svg: ["Import SVG", "Bring in your own logo or art as an SVG file."],
  hole: ["Add hole", "Key ring holes, edge tabs and wall-hanging slots."], plate: ["Plate and border", "Plate shape, colour, corners and border."],
  thickness: ["Thickness", "Set the height of each kind of element."],
};

export function openSignEditor(root, projectId, { onExit }) {
  let rec = projects.get(projectId);
  const isNew = !rec;
  if (!rec) rec = { id: projectId, name: "My sign", doc: blank() };
  const S = {
    doc: rec.doc, sel: null, tool: "plate", mode: "2d", zoom: 1, pan: { x: 0, y: 0 }, hand: false,
    undo: [], redo: [], clip: null, result: null, saved: true, panelOpen: true,
  };
  S.doc.name = rec.name;

  // ---------- layout ----------
  const nameInp = h("input", { class: "se-name", value: rec.name, "aria-label": "Project name", maxlength: 60,
    onchange: (e) => { S.doc.name = e.target.value.trim() || "My sign"; commit(false); } });
  const savedEl = h("span", { class: "se-saved" });
  const head = h("div", { class: "se-card se-head" },
    h("button", { class: "se-ib", type: "button", "aria-label": "Back to my list", onclick: () => { save(); onExit(); } }, icon("back")), nameInp, savedEl);

  const thumb = h("div", { class: "se-thumb", "aria-hidden": "true" });
  const toolBtn = (id, label) => {
    const b = h("button", { type: "button", class: "se-tool", "data-tool": id, onclick: () => toolClick(id) }, icon(id === "thickness" ? "thick" : id), h("span", {}, label),
      h("span", { class: "se-tip", role: "tooltip" }, h("strong", {}, TIPS[id][0]), h("span", {}, TIPS[id][1])));
    return b;
  };
  const toolbar = h("div", { class: "se-toolbar", role: "toolbar", "aria-label": "Add to your design" }, thumb, h("span", { class: "se-div" }),
    toolBtn("text", "Text"), toolBtn("icon", "Icon"), toolBtn("shape", "Shape"), toolBtn("svg", "SVG"), toolBtn("hole", "Hole"),
    h("span", { class: "se-div" }), toolBtn("plate", "Plate"), toolBtn("thickness", "Thickness"));
  const shapePop = h("div", { class: "se-pop se-shapes", hidden: true }, SHAPES.map((s) =>
    h("button", { type: "button", title: s.name, "aria-label": s.name, onclick: () => { addShape(s.id); shapePop.hidden = true; } }, miniShape(shapeOutline(s.id, 20, 20, 0)))));

  const leftBtn = (name, label, fn, key) => h("button", { type: "button", class: "se-ib", title: `${label}${key ? ` (${key})` : ""}`, "aria-label": label, "data-act": name, onclick: fn }, icon(name));
  const left = h("div", { class: "se-card se-left" },
    leftBtn("select", "Select", () => setHand(false)), leftBtn("pan", "Pan", () => setHand(true)),
    leftBtn("copy", "Copy", copySel, "Ctrl+C"), leftBtn("paste", "Paste", paste, "Ctrl+V"),
    leftBtn("undo", "Undo", undo, "Ctrl+Z"), leftBtn("redo", "Redo", redo, "Ctrl+Y"), leftBtn("trash", "Delete", delSel, "Del"));

  const mode2 = h("button", { type: "button", "aria-pressed": "true", onclick: () => setMode("2d") }, "2D");
  const mode3 = h("button", { type: "button", "aria-pressed": "false", onclick: () => setMode("3d") }, "3D");
  const zoomSel = h("select", { class: "se-zoom", "aria-label": "Zoom", onchange: (e) => { if (e.target.value === "fit") fitView(); else setZoom(+e.target.value); e.target.value = ""; } },
    h("option", { value: "" }, "100%"), ["fit", 0.5, 0.75, 1, 1.5, 2, 3].map((z) => h("option", { value: z }, z === "fit" ? "Fit" : `${z * 100}%`)));
  const gearMenu = h("div", { class: "se-menu", hidden: true });
  const dlMenu = h("div", { class: "se-menu se-dlmenu", hidden: true },
    h("button", { type: "button", onclick: () => doDownload("3mf") }, h("strong", {}, "3MF"), h("span", {}, "One part per colour, ready for the AMS")),
    h("button", { type: "button", onclick: () => doDownload("stl") }, h("strong", {}, "STL"), h("span", {}, "One single-colour body")),
    h("button", { type: "button", onclick: () => exportJSON() }, h("strong", {}, "Template file"), h("span", {}, "Save this design as a JSON template")));
  const right = h("div", { class: "se-right" },
    h("div", { class: "se-card se-modes" }, h("div", { class: "se-seg", role: "group", "aria-label": "View" }, mode2, mode3), zoomSel),
    h("div", { class: "se-card se-acts" },
      h("button", { type: "button", class: "se-ib", "aria-label": "Settings", onclick: (e) => { e.stopPropagation(); paintGear(); gearMenu.hidden = !gearMenu.hidden; dlMenu.hidden = true; } }, icon("gear")),
      h("button", { type: "button", class: "se-dl", onclick: (e) => { e.stopPropagation(); dlMenu.hidden = !dlMenu.hidden; gearMenu.hidden = true; } }, "Download")),
    gearMenu, dlMenu);

  const svg = h("svg", { class: "se-svg", tabindex: "0", "aria-label": "Design canvas" });
  const view3 = h("div", { class: "se-3d", hidden: true });
  const floatBar = h("div", { class: "se-float", hidden: true });
  const panel = h("aside", { class: "se-card se-panel", "aria-label": "Properties" });
  const checksEl = h("div", { class: "se-checks" });
  const stage = h("div", { class: "se-stage" }, svg, view3, floatBar);
  const busy = h("div", { class: "se-busy", hidden: true }, "Updating 3D");
  const ed = h("div", { class: "se" }, stage, head, h("div", { class: "se-top" }, toolbar, shapePop), left, right, panel, checksEl, busy);
  root.replaceChildren(ed);

  const preview = new Preview(view3, { dark: true });

  // ---------- history ----------
  function snapshot() { return JSON.stringify(S.doc); }
  let last = snapshot();
  function commit(rebuild = true) {
    const now = snapshot();
    if (now !== last) { S.undo.push(last); if (S.undo.length > 100) S.undo.shift(); S.redo = []; last = now; S.saved = false; queueSave(); }
    if (rebuild) refresh(); else paintChrome();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(last); last = S.undo.pop(); S.doc = JSON.parse(last); fixSel(); S.saved = false; queueSave(); refresh(); }
  function redo() { if (!S.redo.length) return; S.undo.push(last); last = S.redo.pop(); S.doc = JSON.parse(last); fixSel(); S.saved = false; queueSave(); refresh(); }
  function fixSel() { if (S.sel && !S.doc.els.some((e) => e.id === S.sel) && !S.doc.holes.some((x) => x.id === S.sel)) S.sel = null; }

  let saveT = null;
  function queueSave() { paintSaved(); clearTimeout(saveT); saveT = setTimeout(save, 600); }
  let deleted = false;
  function save() {
    clearTimeout(saveT);
    if (deleted) return;
    const r = projects.save({ id: rec.id, name: S.doc.name, doc: S.doc, thumb: thumbSvg() });
    if (r) { S.saved = true; rec = r; } else toast("This browser is out of room for projects. Delete an old one.");
    paintSaved();
  }
  function paintSaved() { savedEl.replaceChildren(S.saved ? icon("check", "ico sm") : "", S.saved ? "Saved" : "Saving"); savedEl.classList.toggle("on", S.saved); }

  // ---------- element helpers ----------
  const selEl = () => S.doc.els.find((e) => e.id === S.sel) || null;
  const selHole = () => S.doc.holes.find((e) => e.id === S.sel) || null;
  function addEl(el) { S.doc.els.push(el); S.sel = el.id; S.tool = null; commit(); }
  function addText() {
    addEl({ id: uid(), kind: "text", text: "Your text", x: 0, y: 0, rot: 0, color: contrastColor(), font: "montserrat", size: 12, bold: false, align: "center", lineGap: 0.25, spacing: 0, curve: 0 });
  }
  function addShape(kind) { addEl({ id: uid(), kind: "shape", shape: kind, x: 0, y: 0, rot: 0, w: 24, h: 24, r: 0, color: contrastColor() }); }
  function addIcon(name, filled) { addEl({ id: uid(), kind: "icon", name, filled: !!filled, x: 0, y: 0, rot: 0, size: 24, color: contrastColor() }); }
  async function addSvg(file) {
    if (!file) return;
    if (file.size > 2e6) { toast("That SVG is over 2 MB. Simplify it first."); return; }
    const text = await file.text();
    const el = { id: uid(), kind: "svg", svg: text, svgId: uid(), x: 0, y: 0, rot: 0, size: Math.min(60, (S.doc.plate.h || 60) * 0.6), color: contrastColor() };
    try { await elementLocal(el); } catch (e) { toast(e.message || "That SVG couldn't be read."); return; }
    closeModal(); addEl(el);
  }
  function contrastColor() { const p = filament(S.doc.plate.color).hex; const l = parseInt(p.slice(1, 3), 16) * 0.3 + parseInt(p.slice(3, 5), 16) * 0.59 + parseInt(p.slice(5, 7), 16) * 0.11; return S.doc.plate.style === "none" ? "black" : l > 140 ? "black" : "white"; }
  function copySel() { const e = selEl(); if (e) { S.clip = clone(e); toast("Copied"); } }
  function paste() { if (!S.clip) return; const e = { ...clone(S.clip), id: uid(), x: S.clip.x + 6, y: S.clip.y + 6 }; S.clip = clone(e); addEl(e); }
  function delSel() {
    if (selEl()) S.doc.els = S.doc.els.filter((e) => e.id !== S.sel);
    else if (selHole()) S.doc.holes = S.doc.holes.filter((e) => e.id !== S.sel);
    else return;
    S.sel = null; commit();
  }
  function moveLayer(dir) {
    const i = S.doc.els.findIndex((e) => e.id === S.sel); const j = i + dir;
    if (i < 0 || j < 0 || j >= S.doc.els.length) return;
    const a = S.doc.els; [a[i], a[j]] = [a[j], a[i]]; commit();
  }

  // ---------- tools ----------
  function toolClick(id) {
    shapePop.hidden = true;
    if (S.mode === "3d" && id !== "thickness") setMode("2d");
    if (id === "text") return addText();
    if (id === "shape") { shapePop.hidden = false; return; }
    if (id === "svg") return svgModal();
    S.tool = id; S.sel = null; S.panelOpen = true; paintAll();
  }
  function setHand(on) { S.hand = on; ed.classList.toggle("hand", on); paintChrome(); }
  function setMode(m) {
    S.mode = m; svg.style.display = m === "3d" ? "none" : ""; view3.hidden = m !== "3d"; floatBar.hidden = true;
    ed.classList.toggle("is3d", m === "3d");
    if (m === "3d") { S.tool = "thickness"; S.sel = null; preview.resize(); show3d(true); }
    paintAll();
  }

  // ---------- canvas (2D) ----------
  const vb = { w: 0, h: 0 };
  function canvasSize() { const r = stage.getBoundingClientRect(); vb.w = r.width; vb.h = r.height; }
  function contentBox() {
    const P = S.doc.plate;
    if (S.result && S.result.bb && S.result.bb.w) return { w: S.result.bb.w, h: S.result.bb.h, cx: S.result.bb.cx, cy: -S.result.bb.cy };
    return { w: P.w || 100, h: P.h || 60, cx: 0, cy: 0 };
  }
  // the part of the stage not covered by the floating cards, in css px
  function freeRect() {
    canvasSize(); const mob = vb.w <= 860;
    const pOpen = !panel.hidden;
    if (mob) return { l: 50, t: 56, r: vb.w - 8, b: pOpen ? vb.h - 78 - panel.offsetHeight : vb.h - 84 };
    return { l: 70, t: 84, r: pOpen ? vb.w - 330 : vb.w - 16, b: vb.h - 56 };
  }
  function fitView() {
    const f = freeRect(); const b = contentBox();
    const fw = Math.max(60, f.r - f.l), fh = Math.max(60, f.b - f.t);
    S.zoom = Math.max(0.2, Math.min(8, Math.min(fw / (b.w + 24), fh / (b.h + 36)) / PX));
    S.pan = { x: -b.cx, y: -b.cy }; paintCanvas(); paintChrome();
  }
  function setZoom(z) { S.zoom = Math.max(0.2, Math.min(8, z)); paintCanvas(); }
  const PX = 3.78; // css px per mm at 100%
  function viewBox() {
    const f = freeRect(); const s = S.zoom * PX; const w = vb.w / s, hh = vb.h / s;
    // put the pan point at the middle of the free area
    const cx = (f.l + f.r) / 2, cy = (f.t + f.b) / 2;
    return { x: -S.pan.x - cx / s, y: -S.pan.y - cy / s, w, h: hh, s };
  }
  function toMM(ev) { const v = viewBox(); const r = svg.getBoundingClientRect(); return { x: v.x + (ev.clientX - r.left) / v.s, y: v.y + (ev.clientY - r.top) / v.s }; }

  async function paintCanvas() {
    const v = viewBox();
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    const d = S.doc, r = S.result;
    const g = [];
    // design area guides
    if (r && r.plate.length) {
      g.push(h("path", { d: pathD(r.plate), fill: filament(d.plate.color).hex, stroke: "rgb(0 0 0 / .18)", "stroke-width": 0.3 / S.zoom, "fill-rule": "nonzero", class: "se-plate" }));
      if (r.border.length) g.push(h("path", { d: pathD(r.border), fill: filament(d.plate.border.color).hex }));
    }
    for (const e of d.els) {
      const local = await elementLocal(e).catch(() => []);
      g.push(h("g", { transform: `translate(${e.x} ${e.y}) rotate(${e.rot || 0})`, "data-id": e.id, class: "se-el" },
        h("path", { d: pathD(local), fill: filament(e.color).hex, "fill-rule": "nonzero" }),
        h("path", { d: pathD(offset(local, 1.2)), fill: "transparent", class: "se-hit" })));
    }
    if (!d.hideHoles) for (const ho of d.holes) {
      g.push(h("g", { class: `se-hole${d.lockHoles ? " locked" : ""}`, "data-hole": ho.id },
        h("circle", { cx: ho.x, cy: ho.y, r: ho.d / 2, fill: ho.type === "back" ? "rgb(0 0 0 / .12)" : "var(--se-bg)", stroke: "#0e7c74", "stroke-width": 0.5 / S.zoom, "stroke-dasharray": ho.type === "back" ? `${2 / S.zoom} ${1.5 / S.zoom}` : null }),
        ho.type === "back" ? h("path", { d: `M${ho.x - ho.d * 0.28} ${ho.y}v${ho.d * 1.4}h${ho.d * 0.56}v${-ho.d * 1.4}`, fill: "none", stroke: "#0e7c74", "stroke-width": 0.4 / S.zoom }) : null));
    }
    // rulers under and left of the content
    const b = r && r.bb && r.bb.w ? r.bb : null;
    if (b) {
      const y = -b.y0 + 8 / S.zoom * 2, x = b.x0 - 8 / S.zoom * 2, sw = 0.25 / S.zoom, fs = 3.2 / S.zoom;
      g.push(h("g", { class: "se-ruler" },
        h("path", { d: `M${b.x0} ${y}H${b.x1}M${b.x0} ${y - 1.5 / S.zoom}v${3 / S.zoom}M${b.x1} ${y - 1.5 / S.zoom}v${3 / S.zoom}`, "stroke-width": sw }),
        h("text", { x: b.cx, y: y + 1.1 / S.zoom, "font-size": fs, "text-anchor": "middle", class: "se-rtxt" }, fmt(b.w, d.units)),
        h("path", { d: `M${x} ${-b.y1}V${-b.y0}M${x - 1.5 / S.zoom} ${-b.y1}h${3 / S.zoom}M${x - 1.5 / S.zoom} ${-b.y0}h${3 / S.zoom}`, "stroke-width": sw }),
        h("text", { x, y: -b.cy, "font-size": fs, "text-anchor": "middle", transform: `rotate(-90 ${x} ${-b.cy})`, class: "se-rtxt" }, fmt(b.h, d.units))));
    }
    // selection
    const e = selEl();
    if (e) {
      const lb = bounds(await elementLocal(e).catch(() => []));
      const pad = 1.2, s = 1 / S.zoom, hs = 2.6 * s;
      const x0 = lb.x0 - pad, x1 = lb.x1 + pad, y0 = -lb.y1 - pad, y1 = -lb.y0 + pad;
      const handle = (hx, hy, kind, cur) => h("rect", { x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs, class: "se-handle", "data-handle": kind, style: `cursor:${cur}`, "stroke-width": 0.35 * s });
      g.push(h("g", { transform: `translate(${e.x} ${e.y}) rotate(${e.rot || 0})`, class: "se-selbox" },
        h("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: "none", "stroke-width": 0.35 * s }),
        handle(x0, y0, "nw", "nwse-resize"), handle(x1, y0, "ne", "nesw-resize"), handle(x0, y1, "sw", "nesw-resize"), handle(x1, y1, "se", "nwse-resize"),
        e.kind === "shape" ? [handle((x0 + x1) / 2, y0, "n", "ns-resize"), handle((x0 + x1) / 2, y1, "s", "ns-resize"), handle(x0, (y0 + y1) / 2, "w", "ew-resize"), handle(x1, (y0 + y1) / 2, "e", "ew-resize")] : null,
        h("line", { x1: (x0 + x1) / 2, y1, x2: (x0 + x1) / 2, y2: y1 + 6 * s, "stroke-width": 0.35 * s }),
        h("circle", { cx: (x0 + x1) / 2, cy: y1 + 8 * s, r: 2.2 * s, class: "se-handle se-rot", "data-handle": "rot", "stroke-width": 0.35 * s })));
    }
    const hsel = selHole();
    if (hsel) g.push(h("circle", { cx: hsel.x, cy: hsel.y, r: hsel.d / 2 + 1.2, class: "se-holesel", fill: "none", "stroke-width": 0.4 / S.zoom }));
    svg.replaceChildren(h("rect", { x: v.x, y: v.y, width: v.w, height: v.h, fill: "transparent", class: "se-bgclick" }), ...g);
    paintFloat();
  }

  // pointer: select, move, resize, rotate, pan, move holes
  let drag = null;
  svg.addEventListener("pointerdown", async (ev) => {
    if (ev.button === 1 || S.hand || ev.button === 2) { drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, pan: { ...S.pan } }; svg.setPointerCapture(ev.pointerId); return; }
    const p = toMM(ev);
    const hd = ev.target.closest("[data-handle]");
    const e = selEl();
    if (hd && e) {
      const lb = bounds(await elementLocal(e));
      drag = { kind: hd.dataset.handle, el: e, start: p, orig: clone(e), lb }; svg.setPointerCapture(ev.pointerId); return;
    }
    const hole = ev.target.closest("[data-hole]");
    if (hole) {
      S.sel = hole.dataset.hole; S.tool = "hole"; paintAll();
      if (!S.doc.lockHoles) { const ho = selHole(); drag = { kind: "hole", start: p, orig: { x: ho.x, y: ho.y } }; svg.setPointerCapture(ev.pointerId); }
      return;
    }
    const g = ev.target.closest("[data-id]");
    if (g) {
      S.sel = g.dataset.id; S.tool = null; S.panelOpen = true;
      const el = selEl(); drag = { kind: "move", start: p, orig: { x: el.x, y: el.y }, moved: false };
      svg.setPointerCapture(ev.pointerId); paintAll(); return;
    }
    S.sel = null; if (S.tool !== "hole" && S.tool !== "thickness") S.tool = "plate"; paintAll();
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (drag.kind === "pan") { S.pan = { x: drag.pan.x + (ev.clientX - drag.sx) / (S.zoom * PX), y: drag.pan.y + (ev.clientY - drag.sy) / (S.zoom * PX) }; paintCanvas(); return; }
    const p = toMM(ev); const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.kind === "hole") { const ho = selHole(); ho.x = round(drag.orig.x + dx); ho.y = round(drag.orig.y + dy); paintCanvas(); return; }
    const e = selEl(); if (!e) return;
    if (drag.kind === "move") { e.x = round(drag.orig.x + dx); e.y = round(drag.orig.y + dy); drag.moved = true; liveMove(e); return; }
    if (drag.kind === "rot") {
      let a = Math.atan2(p.y - e.y, p.x - e.x) * 180 / Math.PI - 90;
      if (!ev.shiftKey) { const snap = Math.round(a / 15) * 15; if (Math.abs(snap - a) < 4) a = snap; }
      e.rot = Math.round(((a % 360) + 360) % 360 * 10) / 10; liveMove(e); return;
    }
    // resize in the element's own axes
    const a = -(e.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const lx = (p.x - e.x) * ca - (p.y - e.y) * sa, ly = (p.x - e.x) * sa + (p.y - e.y) * ca;
    const o = drag.orig, lb = drag.lb;
    const hw = Math.max(lb.w / 2, 0.5), hh = Math.max(lb.h / 2, 0.5);
    const k = drag.kind;
    if (e.kind === "shape" && k.length === 1) {
      if (k === "e" || k === "w") e.w = clamp(round(Math.abs(lx) * 2 - 2.4), 2, 400);
      else e.h = clamp(round(Math.abs(ly) * 2 - 2.4), 2, 400);
    } else {
      const f = Math.max(Math.abs(lx) / (hw + 1.2), Math.abs(ly) / (hh + 1.2));
      if (e.kind === "text") e.size = clamp(round(o.size * f), 2, 200);
      else if (e.kind === "shape") { e.w = clamp(round(o.w * f), 2, 400); e.h = clamp(round(o.h * f), 2, 400); }
      else e.size = clamp(round(o.size * f), 3, 400);
    }
    scheduleCanvas();
  });
  svg.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "pan") return;
    if (d.kind === "move" && !d.moved) return;
    commit();
  });
  svg.addEventListener("dblclick", (ev) => {
    const g = ev.target.closest("[data-id]"); if (!g) return;
    const e = S.doc.els.find((x) => x.id === g.dataset.id);
    if (e && e.kind === "text") { S.sel = e.id; S.panelOpen = true; paintAll(); setTimeout(() => { const t = panel.querySelector("textarea"); if (t) { t.focus(); t.select(); } }, 0); }
  });
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) setZoom(S.zoom * Math.exp(-ev.deltaY * 0.01));
    else { S.pan.x -= ev.deltaX / (S.zoom * PX); S.pan.y -= ev.deltaY / (S.zoom * PX); paintCanvas(); }
  }, { passive: false });
  svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
  function liveMove(e) {
    const g = svg.querySelector(`[data-id="${e.id}"]`); const t = `translate(${e.x} ${e.y}) rotate(${e.rot || 0})`;
    if (g) g.setAttribute("transform", t);
    const sb = svg.querySelector(".se-selbox"); if (sb) sb.setAttribute("transform", t);
    floatBar.hidden = true;
  }
  let canvasRaf = 0;
  function scheduleCanvas() { cancelAnimationFrame(canvasRaf); canvasRaf = requestAnimationFrame(() => paintCanvas()); }

  // ---------- keyboard ----------
  function onKey(ev) {
    if (!document.body.contains(ed)) { window.removeEventListener("keydown", onKey); return; }
    const typing = ev.target.matches("input,textarea,select,[contenteditable]");
    if (typing) return;
    const mod = ev.ctrlKey || ev.metaKey; const k = ev.key.toLowerCase();
    if (mod && k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
    else if (mod && (k === "y" || (k === "z" && ev.shiftKey))) { ev.preventDefault(); redo(); }
    else if (mod && k === "c") { copySel(); }
    else if (mod && k === "v") { paste(); }
    else if (mod && k === "d") { ev.preventDefault(); copySel(); paste(); }
    else if (k === "delete" || k === "backspace") { ev.preventDefault(); delSel(); }
    else if (k === "escape") { S.sel = null; shapePop.hidden = true; gearMenu.hidden = dlMenu.hidden = true; closeModal(); paintAll(); }
    else if (k.startsWith("arrow")) {
      const e = selEl() || (S.doc.lockHoles ? null : selHole()); if (!e) return;
      ev.preventDefault(); const st = ev.shiftKey ? 5 : 0.5;
      if (k === "arrowleft") e.x -= st; if (k === "arrowright") e.x += st; if (k === "arrowup") e.y -= st; if (k === "arrowdown") e.y += st;
      e.x = round(e.x); e.y = round(e.y); commit();
    }
  }
  window.addEventListener("keydown", onKey);
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".se-right")) { gearMenu.hidden = true; dlMenu.hidden = true; } if (!ev.target.closest(".se-top")) shapePop.hidden = true; });

  // ---------- floating text bar ----------
  function paintFloat() {
    const e = selEl();
    if (!e || S.mode === "3d" || drag) { floatBar.hidden = true; return; }
    const set = (k, v) => { e[k] = v; commit(); };
    const items = [h("span", { class: "se-fl-kind" }, ({ text: "Text", icon: "Icon", shape: "Shape", svg: "SVG" })[e.kind])];
    items.push(colorDrop(e.color, (c) => set("color", c)));
    if (e.kind === "text") {
      items.push(h("button", { type: "button", class: "se-ib", title: "Import local fonts", "aria-label": "Import local fonts", onclick: importFont }, icon("upload")));
      items.push(h("select", { class: "se-fl-font", title: "Font", "aria-label": "Font", onchange: (ev) => set("font", ev.target.value) },
        FONTS.map((f) => h("option", { value: f.id, selected: f.id === e.font }, f.name))));
      items.push(h("input", { class: "se-fl-size", type: "number", min: 2, max: 200, step: 0.5, value: e.size, title: "Size (letter height, mm)", "aria-label": "Size", onchange: (ev) => set("size", clamp(+ev.target.value || e.size, 2, 200)) }));
      items.push(h("span", { class: "se-div light" }));
      items.push(h("button", { type: "button", class: `se-ib${e.curve ? " on" : ""}`, title: "Curved text", "aria-label": "Curved text", onclick: () => { S.panelOpen = true; paintPanel(); const r = panel.querySelector('[data-k="curve"]'); if (r) r.focus(); } }, icon("curve")));
      items.push(h("button", { type: "button", class: `se-ib${e.bold ? " on" : ""}`, title: "Bold", "aria-label": "Bold", "aria-pressed": e.bold ? "true" : "false", onclick: () => set("bold", !e.bold) }, icon("bold")));
      for (const [al, ic] of [["left", "alignL"], ["center", "alignC"], ["right", "alignR"]]) items.push(h("button", { type: "button", class: `se-ib${e.align === al ? " on" : ""}`, title: `Align ${al}`, "aria-label": `Align ${al}`, onclick: () => set("align", al) }, icon(ic)));
      items.push(h("button", { type: "button", class: "se-ib", title: "Line spacing", "aria-label": "Line spacing", onclick: () => set("lineGap", e.lineGap >= 0.8 ? 0 : Math.round((e.lineGap + 0.25) * 100) / 100) }, icon("lineGap")));
    }
    items.push(h("span", { class: "se-div light" }));
    items.push(h("button", { type: "button", class: "se-ib", title: "Move forward", "aria-label": "Move forward", onclick: () => moveLayer(1) }, icon("fwd")));
    items.push(h("button", { type: "button", class: "se-ib", title: "Move backward", "aria-label": "Move backward", onclick: () => moveLayer(-1) }, icon("bwd")));
    floatBar.replaceChildren(...items);
    floatBar.hidden = false;
    // place it above the element
    const g = svg.querySelector(".se-selbox rect");
    const sr = stage.getBoundingClientRect();
    if (g) {
      const r = g.getBoundingClientRect();
      const fw = floatBar.offsetWidth || 480;
      let left = r.left + r.width / 2 - sr.left - fw / 2; left = Math.max(8, Math.min(sr.width - fw - 8, left));
      let top = r.top - sr.top - 56; if (top < 120) top = r.bottom - sr.top + 34;
      floatBar.style.left = `${left}px`; floatBar.style.top = `${top}px`;
    }
  }
  async function importFont() {
    const f = await pickFile(".ttf,.otf,.woff,font/ttf,font/otf,font/woff");
    if (!f) return;
    try {
      const id = `local-${slug(f.name)}`; registerFont(id, f.name.replace(/\.[^.]+$/, ""), await f.arrayBuffer());
      const e = selEl(); if (e && e.kind === "text") { e.font = id; commit(); }
      toast(`${f.name} is ready to use.`);
    } catch { toast("That font couldn't be read. Use a TTF, OTF or WOFF file."); }
  }
  function colorDrop(cur, onPick) {
    const f = filament(cur);
    const pop = h("div", { class: "se-pop se-colors", hidden: true }, FILAMENTS.map((x) =>
      h("button", { type: "button", class: "sw", title: x.name, "aria-label": x.name, style: `background:${x.hex}`, "aria-pressed": x.id === f.id ? "true" : "false", onclick: () => { pop.hidden = true; onPick(x.id); } })));
    const btn = h("button", { type: "button", class: "se-colorbtn", title: "Colour", "aria-label": `Colour: ${f.name}`, onclick: (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; } },
      h("span", { class: "sw sm", style: `background:${f.hex}` }), icon("down", "ico xs"));
    return h("span", { class: "se-colorwrap" }, btn, pop);
  }

  // ---------- right panel ----------
  function panelHead(title) {
    return h("div", { class: "sp-head" }, h("strong", {}, title),
      h("button", { type: "button", class: "se-ib", "aria-label": "Close panel", onclick: () => { S.panelOpen = false; paintPanel(); } }, icon("close")));
  }
  const num = (label, val, onSet, { min = 0, max = 500, step = 0.5, unit = true } = {}) => {
    const u = S.doc.units, U = UNITS[u] || UNITS.mm;
    const shown = unit ? +(val * U.k).toFixed(U.dp) : val;
    const inp = h("input", { type: "number", class: "sp-num", value: shown, min: unit ? +(min * U.k).toFixed(U.dp) : min, max: unit ? +(max * U.k).toFixed(U.dp) : max, step: unit ? U.step : step, "aria-label": label,
      onchange: (ev) => { let v = +ev.target.value; if (!Number.isFinite(v)) return; if (unit) v = v / U.k; onSet(clamp(round(v), min, max)); } });
    return h("label", { class: "sp-row" }, h("span", {}, label), h("span", { class: "sp-numwrap" }, inp, unit ? h("span", { class: "sp-unit" }, u) : null));
  };
  const slider = (label, val, onSet, { min, max, step, unitLabel = "", k = "" }) => {
    const out = h("span", { class: "sp-val" }, `${val}${unitLabel}`);
    const inp = h("input", { type: "range", min, max, step, value: val, "aria-label": label, "data-k": k,
      oninput: (ev) => { out.textContent = `${ev.target.value}${unitLabel}`; onSet(+ev.target.value, false); }, onchange: (ev) => onSet(+ev.target.value, true) });
    return h("div", { class: "sp-slider" }, h("div", { class: "sp-row" }, h("span", {}, label), out), inp);
  };
  const colorRow = (label, cur, onPick) => h("div", { class: "sp-row" }, h("span", {}, label), colorDrop(cur, onPick));
  const segRow = (label, opts, cur, onPick) => h("div", { class: "sp-row" }, h("span", {}, label),
    h("div", { class: "se-seg sm" }, opts.map(([v, l]) => h("button", { type: "button", "aria-pressed": v === cur ? "true" : "false", onclick: () => onPick(v) }, l))));
  const check = (label, on, onSet, note) => h("label", { class: "sp-check" }, h("input", { type: "checkbox", checked: on, onchange: (ev) => onSet(ev.target.checked) }), h("span", {}, label, note ? h("small", {}, note) : null));

  function paintPanel() {
    if (!S.panelOpen) { panel.hidden = true; return; }
    panel.hidden = false;
    const d = S.doc; const e = selEl(); const ho = selHole();
    let body = [];
    if (e) body = elementPanel(e);
    else if (S.tool === "hole" || ho) body = holePanel(ho);
    else if (S.tool === "icon") body = iconPanel();
    else if (S.tool === "thickness") body = thickPanel();
    else body = platePanel(d);
    panel.replaceChildren(...body);
  }

  function platePanel(d) {
    const P = d.plate;
    const setP = (k, v) => { P[k] = v; commit(); };
    const styles = h("div", { class: "sp-styles" }, PLATE_STYLES.map((s) => h("button", { type: "button", title: s.name, "aria-label": s.name, "aria-pressed": P.style === s.id ? "true" : "false",
      onclick: () => { P.style = s.id; if (s.w) { P.w = s.w; P.h = s.h; } if (s.r != null) P.r = s.r; commit(); rebuild().then(fitView); } },
    s.id === "none" ? icon("close") : s.id === "outline" ? miniShape(offset(shapeOutline("star", 16, 16, 0), 2), true) : miniShape(plateOutline(s.id, s.w, s.h, s.r || 0)))),
    h("button", { type: "button", title: "Your own outline (SVG)", "aria-label": "Your own outline (SVG)", "aria-pressed": P.style === "svg" ? "true" : "false", onclick: async () => {
      const f = await pickFile(".svg,image/svg+xml"); if (!f) return;
      P.svg = await f.text(); P.svgId = uid(); P.style = "svg";
      try { await elementLocal({ kind: "svg", svg: P.svg, svgId: P.svgId, size: Math.max(P.w, P.h) }); } catch (er) { toast(er.message); P.style = "rect"; return; }
      commit(); rebuild().then(fitView);
    } }, icon("svg")));
    const rows = [panelHead("Plate and border"), h("div", { class: "sp-sec" }, h("h4", {}, "Base plate style"), styles)];
    if (P.style !== "none") {
      const sec = h("div", { class: "sp-sec" }, colorRow("Colour", P.color, (c) => setP("color", c)));
      if (P.style === "outline") sec.append(num("Margin", P.margin ?? 4, (v) => setP("margin", v), { min: 1, max: 30 }));
      else {
        sec.append(num("Width", P.w, (v) => setP("w", v), { min: 10, max: 250 }), num("Height", P.h, (v) => setP("h", v), { min: 10, max: 250 }));
        if (["rect", "triangle", "star", "cat"].includes(P.style)) sec.append(slider("Corner radius", P.r || 0, (v, done) => { P.r = v; if (done) commit(); else scheduleBuild(); }, { min: 0, max: Math.round(Math.min(P.w, P.h) / 2), step: 0.5, unitLabel: " mm" }));
      }
      rows.push(sec);
      rows.push(h("div", { class: "sp-sec" }, h("h4", {}, "Border"),
        h("label", { class: "sp-row" }, h("span", {}, "Weight"), h("select", { class: "sp-sel", onchange: (ev) => { P.border.weight = ev.target.value; commit(); } },
          Object.keys(BORDER_WEIGHTS).map((w) => h("option", { value: w, selected: P.border.weight === w }, w[0].toUpperCase() + w.slice(1))))),
        P.border.weight !== "none" ? [colorRow("Colour", P.border.color, (c) => { P.border.color = c; commit(); }),
          slider("Offset", P.border.offset, (v, done) => { P.border.offset = v; if (done) commit(); else scheduleBuild(); }, { min: 0, max: 20, step: 0.5, unitLabel: " mm" })] : null));
    }
    return rows;
  }

  function thickPanel() {
    const T = S.doc.thick;
    const setT = (k) => (v) => { T[k] = v; commit(); };
    return [panelHead("Thickness"),
      h("div", { class: "sp-sec" }, h("h4", {}, "Basic"),
        num("Base plate", T.base, setT("base"), { min: 0.6, max: 20, step: 0.2 }),
        num("Text and icons", T.text, setT("text"), { min: 0.2, max: 10, step: 0.2 }),
        num("SVG", T.svg, setT("svg"), { min: 0.2, max: 10, step: 0.2 }),
        num("Shapes", T.shape, setT("shape"), { min: 0.2, max: 10, step: 0.2 }),
        S.mode === "2d" ? h("button", { type: "button", class: "sp-btn primary", onclick: () => setMode("3d") }, "View in 3D") : null),
      h("div", { class: "sp-sec" }, h("h4", {}, "Special mode"),
        check("Face-down mode", !!S.doc.facedown, (v) => { S.doc.facedown = v; commit(); },
          "Everything is set into the base plate so the front is flat. The sign prints face down on the bed for a smooth, glossy front."))];
  }

  let holeType = "inside", holePreset = "top", holeSize = 5;
  function holePanel(ho) {
    const d = S.doc;
    const typeCard = (id, label, pic) => h("button", { type: "button", class: "sp-holetype", "aria-pressed": (ho ? ho.type : holeType) === id ? "true" : "false",
      onclick: () => { if (ho) { ho.type = id; commit(); } else { holeType = id; paintPanel(); } } }, pic, h("span", {}, label));
    const pics = {
      inside: h("svg", { viewBox: "0 0 40 30" }, h("rect", { x: 4, y: 4, width: 32, height: 22, rx: 3, fill: "currentColor", opacity: ".25" }), h("circle", { cx: 10, cy: 10, r: 2.6, fill: "var(--card)" })),
      boundary: h("svg", { viewBox: "0 0 40 30" }, h("rect", { x: 10, y: 4, width: 26, height: 22, rx: 3, fill: "currentColor", opacity: ".25" }), h("circle", { cx: 9, cy: 15, r: 6, fill: "currentColor", opacity: ".25" }), h("circle", { cx: 8, cy: 15, r: 2.6, fill: "var(--card)" })),
      back: h("svg", { viewBox: "0 0 40 30" }, h("rect", { x: 4, y: 4, width: 32, height: 22, rx: 3, fill: "currentColor", opacity: ".25" }), h("path", { d: "M20 9v9", stroke: "var(--card)", "stroke-width": "3", "stroke-linecap": "round" }), h("circle", { cx: 20, cy: 18, r: 3, fill: "var(--card)" })),
    };
    const rows = [panelHead("Hole"),
      h("div", { class: "sp-sec" }, h("div", { class: "sp-row" }, h("h4", {}, ho ? "Selected hole" : "Add hole")),
        h("p", { class: "sp-note" }, "Holes can be dragged on the canvas. Lock them in View options."),
        h("div", { class: "sp-holetypes" }, typeCard("inside", "Inside", pics.inside), typeCard("boundary", "Edge tab", pics.boundary), typeCard("back", "Back slot", pics.back)),
        ho ? [num("Size", ho.d, (v) => { ho.d = v; commit(); }, { min: 2, max: 40 }), num("Across", ho.x, (v) => { ho.x = v; commit(); }, { min: -200, max: 200 }), num("Down", ho.y, (v) => { ho.y = v; commit(); }, { min: -200, max: 200 }),
          h("button", { type: "button", class: "sp-btn", onclick: delSel }, "Remove hole")]
          : [h("label", { class: "sp-row" }, h("span", {}, "Position"), h("select", { class: "sp-sel", onchange: (ev) => { holePreset = ev.target.value; } }, HOLE_PRESETS.map((p) => h("option", { value: p.id, selected: p.id === holePreset }, p.name)))),
            h("label", { class: "sp-row" }, h("span", {}, "Size"), h("select", { class: "sp-sel", onchange: (ev) => { holeSize = +ev.target.value; } }, HOLE_SIZES.map((s) => h("option", { value: s, selected: s === holeSize }, fmt(s, d.units))))),
            h("button", { type: "button", class: "sp-btn primary", onclick: () => { const hs = presetHoles(d, holePreset, holeType, holeType === "back" ? Math.max(8, holeSize) : holeSize); d.holes.push(...hs); S.sel = hs[0].id; commit(); } }, "Add hole")]),
      h("div", { class: "sp-sec" }, h("h4", {}, "View options"),
        check("Lock holes", !!d.lockHoles, (v) => { d.lockHoles = v; commit(); }), check("Hide holes", !!d.hideHoles, (v) => { d.hideHoles = v; commit(false); paintCanvas(); }),
        d.holes.length ? h("p", { class: "sp-note" }, `${d.holes.length} hole${d.holes.length > 1 ? "s" : ""} on this design.`) : null)];
    return rows;
  }

  let iconCat = 0, iconQuery = "", iconFilled = false;
  function iconPanel() {
    const grid = h("div", { class: "sp-icons" }, h("p", { class: "sp-note" }, "Loading icons"));
    const tabs = h("div", { class: "sp-icontabs" });
    const search = h("input", { class: "sp-search", type: "search", placeholder: "Search icons", value: iconQuery, "aria-label": "Search icons",
      oninput: (ev) => { iconQuery = ev.target.value; fill(); } });
    async function fill() {
      const cats = await loadIcons();
      tabs.replaceChildren(...cats.map((c, i) => h("button", { type: "button", "aria-pressed": i === iconCat && !iconQuery ? "true" : "false", onclick: () => { iconCat = i; iconQuery = ""; search.value = ""; fill(); } }, c.title)));
      const q = iconQuery.trim().toLowerCase();
      let list = q ? cats.flatMap((c) => c.icons).filter((i) => i.n.includes(q) || (i.t || []).some((t) => String(t).includes(q))) : cats[iconCat].icons;
      const seen = new Set(); list = list.filter((i) => !seen.has(i.n) && seen.add(i.n)).slice(0, 240);
      grid.replaceChildren(...(list.length ? list.map((ic) => h("button", { type: "button", title: ic.n.replace(/-/g, " "), "aria-label": ic.n.replace(/-/g, " "), onclick: () => addIcon(ic.n, iconFilled && !!ic.f) },
        h("svg", { viewBox: "0 0 24 24" }, (iconFilled && ic.f ? ic.f : ic.o).filter(([, a]) => a.stroke !== "none").map(([tag, a]) => h(tag, { ...a, fill: iconFilled && ic.f ? "currentColor" : "none", stroke: iconFilled && ic.f ? "none" : "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })))))
        : [h("p", { class: "sp-note" }, "No icons match that.")]));
    }
    fill().catch(() => grid.replaceChildren(h("p", { class: "sp-note" }, "The icons didn't load. Check the connection and try again.")));
    return [panelHead("Add icon"), h("div", { class: "sp-sec" }, search,
      segRow("Style", [[false, "Outline"], [true, "Solid"]], iconFilled, (v) => { iconFilled = v; paintPanel(); }), tabs), h("div", { class: "sp-sec sp-iconsec" }, grid)];
  }

  function elementPanel(e) {
    const set = (k, v) => { e[k] = v; commit(); };
    const live = (k) => (v, done) => { e[k] = v; if (done) commit(); else scheduleCanvas(); };
    const title = ({ text: "Text", icon: "Icon", shape: "Shape", svg: "SVG" })[e.kind];
    const rows = [panelHead(title)];
    if (e.kind === "text") {
      const ta = h("textarea", { class: "sp-text", rows: 2, maxlength: 200, "aria-label": "Text", oninput: (ev) => { e.text = ev.target.value; scheduleText(); } });
      ta.value = e.text;
      rows.push(h("div", { class: "sp-sec" }, ta,
        h("div", { class: "sp-fonts" }, FONTS.map((f) => h("button", { type: "button", style: f.local ? "" : `font-family:"ms-${f.id}"`, "aria-pressed": e.font === f.id ? "true" : "false", title: f.name, onclick: () => set("font", f.id) }, f.local ? f.name : (e.text.split("\n")[0] || f.name).slice(0, 12))),
          h("button", { type: "button", class: "sp-importfont", onclick: importFont }, icon("upload", "ico sm"), "Import font")),
        num("Letter height", e.size, (v) => set("size", v), { min: 2, max: 200 }),
        colorRow("Colour", e.color, (c) => set("color", c)),
        segRow("Align", [["left", "Left"], ["center", "Centre"], ["right", "Right"]], e.align, (v) => set("align", v)),
        check("Bold", !!e.bold, (v) => set("bold", v)),
        slider("Curve", e.curve || 0, live("curve"), { min: -300, max: 300, step: 5, unitLabel: "°", k: "curve" }),
        slider("Letter spacing", e.spacing || 0, live("spacing"), { min: -2, max: 10, step: 0.1, unitLabel: " mm" }),
        slider("Line spacing", e.lineGap ?? 0.25, live("lineGap"), { min: 0, max: 1.5, step: 0.05 })));
    } else if (e.kind === "icon") {
      rows.push(h("div", { class: "sp-sec" }, h("p", { class: "sp-note" }, e.name.replace(/-/g, " ")), num("Size", e.size, (v) => set("size", v), { min: 3, max: 250 }), colorRow("Colour", e.color, (c) => set("color", c)),
        segRow("Style", [[false, "Outline"], [true, "Solid"]], !!e.filled, (v) => set("filled", v)),
        h("button", { type: "button", class: "sp-btn", onclick: () => { S.sel = null; S.tool = "icon"; paintAll(); } }, "Add another icon")));
    } else if (e.kind === "shape") {
      rows.push(h("div", { class: "sp-sec" }, segRow("Shape", SHAPES.map((s) => [s.id, s.name]), e.shape, (v) => set("shape", v)),
        num("Width", e.w, (v) => set("w", v), { min: 2, max: 400 }), num("Height", e.h, (v) => set("h", v), { min: 2, max: 400 }),
        slider("Corner radius", e.r || 0, live("r"), { min: 0, max: Math.round(Math.min(e.w, e.h) / 2), step: 0.5, unitLabel: " mm" }),
        colorRow("Colour", e.color, (c) => set("color", c))));
    } else if (e.kind === "svg") {
      rows.push(h("div", { class: "sp-sec" }, num("Size", e.size, (v) => set("size", v), { min: 3, max: 250 }), colorRow("Colour", e.color, (c) => set("color", c)),
        h("p", { class: "sp-note" }, "Dark parts of the SVG print; white parts are left out.")));
    }
    rows.push(h("div", { class: "sp-sec" }, h("h4", {}, "Position"),
      num("Across", e.x, (v) => set("x", v), { min: -300, max: 300 }), num("Down", e.y, (v) => set("y", v), { min: -300, max: 300 }),
      slider("Rotate", Math.round(e.rot || 0), live("rot"), { min: 0, max: 359, step: 1, unitLabel: "°" }),
      h("div", { class: "sp-btnrow" },
        h("button", { type: "button", class: "sp-btn", onclick: () => moveLayer(1) }, icon("fwd", "ico sm"), "Forward"),
        h("button", { type: "button", class: "sp-btn", onclick: () => moveLayer(-1) }, icon("bwd", "ico sm"), "Backward"),
        h("button", { type: "button", class: "sp-btn", onclick: () => { copySel(); paste(); } }, icon("copy", "ico sm"), "Duplicate"),
        h("button", { type: "button", class: "sp-btn danger", onclick: delSel }, icon("trash", "ico sm"), "Delete"))));
    return rows;
  }
  let textT = null;
  function scheduleText() { clearTimeout(textT); textT = setTimeout(() => commit(), 250); }

  // ---------- modals ----------
  let modal = null;
  function openModal(title, body, cls = "") {
    closeModal();
    modal = h("div", { class: "se-modal-bg", onclick: (ev) => { if (ev.target === modal) closeModal(); } },
      h("div", { class: `se-modal ${cls}`, role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "sm-head" }, h("strong", {}, title), h("button", { type: "button", class: "se-ib", "aria-label": "Close", onclick: closeModal }, icon("close"))), body));
    ed.append(modal);
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }
  function svgModal() {
    const drop = h("div", { class: "sm-drop" }, h("strong", {}, icon("upload", "ico sm"), " Import an SVG"),
      h("p", {}, "Drop a file here or browse. It's kept with this project in this browser."),
      h("button", { type: "button", class: "sp-btn primary", onclick: async () => addSvg(await pickFile(".svg,image/svg+xml")) }, "Browse"));
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); addSvg(ev.dataTransfer.files[0]); });
    openModal("Import SVG", h("div", { class: "sm-body" }, drop,
      h("p", { class: "sp-note" }, "Have a JPG or PNG? Trace it to SVG first. The picture keychain maker will do this here soon.")));
  }
  function templateModal() {
    openModal("Start with a template", h("div", { class: "sm-body" },
      h("div", { class: "sm-row" }, h("h4", {}, "Templates"), h("button", { type: "button", class: "sm-link", onclick: importJSON }, "Import template (JSON file)")),
      h("div", { class: "sm-templates" },
        h("button", { type: "button", class: "sm-tpl blank", onclick: closeModal }, h("span", { class: "sm-tpl-pic" }, icon("plus")), h("strong", {}, "Blank")),
        TEMPLATES.map((t) => h("button", { type: "button", class: "sm-tpl", onclick: async () => {
          S.doc = t.make(); S.doc.name = nameInp.value = t.name; S.sel = null; S.tool = "plate"; closeModal(); commit(); rebuild().then(fitView);
        } }, h("span", { class: "sm-tpl-pic", "data-tpl": t.id }), h("strong", {}, t.name))))), "wide");
    // draw template previews
    for (const t of TEMPLATES) {
      const slot = modal.querySelector(`[data-tpl="${t.id}"]`);
      buildSign(t.make()).then((r) => slot.append(docSvg(r, t.make()))).catch(() => {});
    }
  }
  async function importJSON() {
    const f = await pickFile(".json,application/json"); if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!doc || !doc.plate || !Array.isArray(doc.els)) throw new Error();
      S.doc = { ...blank(), ...doc }; nameInp.value = S.doc.name || "My sign"; S.sel = null; closeModal(); commit(); rebuild().then(fitView);
    } catch { toast("That isn't a sign template file."); }
  }
  function exportJSON() {
    dlMenu.hidden = true;
    download(`${slug(S.doc.name)}.json`, new Blob([JSON.stringify(S.doc, null, 1)], { type: "application/json" }));
  }

  function paintGear() {
    const d = S.doc;
    gearMenu.replaceChildren(
      h("div", { class: "mi" }, h("span", {}, "Units"), h("div", { class: "se-seg sm" }, ["mm", "cm", "in"].map((u) => h("button", { type: "button", "aria-pressed": d.units === u ? "true" : "false", onclick: (ev) => { ev.stopPropagation(); d.units = u; commit(false); paintGear(); paintAll(); } }, u)))),
      h("label", { class: "mi" }, h("span", {}, "Show printer bed"), h("input", { type: "checkbox", role: "switch", class: "tgl-in", checked: d.showBed !== false, onchange: (ev) => { d.showBed = ev.target.checked; commit(false); show3d(false); } })),
      h("button", { type: "button", class: "mi", onclick: () => { gearMenu.hidden = true; save(); const id = uid(); projects.save({ id, name: `${S.doc.name} copy`, doc: clone(S.doc), thumb: thumbSvg() }); toast("Copy saved to My list."); } }, "Duplicate"),
      h("button", { type: "button", class: "mi", onclick: () => { gearMenu.hidden = true; templateModal(); } }, "Templates"),
      h("button", { type: "button", class: "mi danger", onclick: () => { gearMenu.hidden = true; confirmDelete(); } }, "Delete this project"));
  }
  function confirmDelete() {
    openModal("Delete this project?", h("div", { class: "sm-body" }, h("p", {}, `“${S.doc.name}” will be removed from My list. This can't be undone.`),
      h("div", { class: "sp-btnrow end" }, h("button", { type: "button", class: "sp-btn", onclick: closeModal }, "Keep it"),
        h("button", { type: "button", class: "sp-btn danger solid", onclick: () => { deleted = true; clearTimeout(saveT); projects.remove(rec.id); closeModal(); onExit(true); } }, "Delete"))));
  }

  // ---------- build + 3D ----------
  let buildT = null, buildSeq = 0;
  function scheduleBuild() { clearTimeout(buildT); buildT = setTimeout(rebuild, 90); }
  async function rebuild() {
    const seq = ++buildSeq;
    busy.hidden = S.mode !== "3d";
    try {
      const r = await buildSign(S.doc);
      if (seq !== buildSeq) return;
      S.result = r; paintCanvas(); paintChecks(); paintThumb();
      if (S.mode === "3d") show3d(false);
    } catch (er) { console.error(er); if (seq === buildSeq) toast(er.message || "That design couldn't be built."); }
    finally { if (seq === buildSeq) busy.hidden = true; }
  }
  function show3d(refit) {
    if (!S.result) return;
    preview.setBed(S.doc.showBed !== false);
    preview.show(S.result.parts, { refit });
  }
  function paintChecks() {
    const r = S.result; if (!r) return;
    const bad = r.checks.filter((c) => c.level === "bad"), warn = r.checks.filter((c) => c.level === "warn");
    checksEl.className = `se-checks ${bad.length ? "bad" : warn.length ? "warn" : "ok"}`;
    checksEl.replaceChildren(h("button", { type: "button", class: "se-checkbtn", "aria-expanded": checksEl.dataset.open ? "true" : "false", onclick: () => { checksEl.dataset.open = checksEl.dataset.open ? "" : "1"; paintChecks(); } },
      h("span", { class: "dot" }), bad.length ? `${bad.length} problem${bad.length > 1 ? "s" : ""} to fix` : warn.length ? `Print check: ${warn.length} note${warn.length > 1 ? "s" : ""}` : "Print check passed"),
      ...(checksEl.dataset.open ? [h("ul", {}, r.checks.map((c) => h("li", { class: c.level }, c.text)))] : []));
  }
  function doDownload(kind) {
    dlMenu.hidden = true;
    const r = S.result; if (!r) return;
    if (r.checks.some((c) => c.level === "bad")) { checksEl.dataset.open = "1"; paintChecks(); toast("Fix the red print check first."); return; }
    const parts = S.doc.facedown ? flipForPrint(r.parts, S.doc._height || r.height) : r.parts;
    const name = slug(S.doc.name);
    if (kind === "stl") download(`${name}.stl`, stl(parts, S.doc.name)); else download(`${name}.3mf`, threeMF(parts, S.doc.name));
    save();
  }

  // ---------- thumbnails ----------
  function docSvg(r, doc) {
    const b = r.bb; const pad = Math.max(b.w, b.h) * 0.08 + 1;
    const g = h("svg", { viewBox: `${b.x0 - pad} ${-b.y1 - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`, class: "doc-svg" });
    if (r.plate.length) g.append(h("path", { d: pathD(r.plate), fill: filament(doc.plate.color).hex, stroke: "rgb(0 0 0 / .15)", "stroke-width": Math.max(b.w, b.h) / 200 }));
    if (r.border.length) g.append(h("path", { d: pathD(r.border), fill: filament(doc.plate.border.color).hex }));
    for (const l of r.layers) if (l.el.kind !== "border") g.append(h("path", { d: pathD(l.paths), fill: filament(l.el.color).hex }));
    return g;
  }
  function thumbSvg() { return S.result ? new XMLSerializer().serializeToString(docSvg(S.result, S.doc)) : ""; }
  function paintThumb() { if (S.result) thumb.replaceChildren(docSvg(S.result, S.doc)); }

  // ---------- paint ----------
  function paintChrome() {
    for (const b of toolbar.querySelectorAll(".se-tool")) b.classList.toggle("on", b.dataset.tool === S.tool && !S.sel);
    left.querySelector('[data-act="select"]').classList.toggle("on", !S.hand);
    left.querySelector('[data-act="pan"]').classList.toggle("on", S.hand);
    left.querySelector('[data-act="undo"]').disabled = !S.undo.length;
    left.querySelector('[data-act="redo"]').disabled = !S.redo.length;
    left.querySelector('[data-act="copy"]').disabled = !selEl();
    left.querySelector('[data-act="paste"]').disabled = !S.clip;
    left.querySelector('[data-act="trash"]').disabled = !selEl() && !selHole();
    mode2.setAttribute("aria-pressed", S.mode === "2d" ? "true" : "false"); mode3.setAttribute("aria-pressed", S.mode === "3d" ? "true" : "false");
    zoomSel.options[0].textContent = `${Math.round(S.zoom * 100)}%`;
    paintSaved();
  }
  function paintAll() { paintChrome(); paintPanel(); paintCanvas(); }
  function refresh() { paintChrome(); paintPanel(); paintCanvas(); scheduleBuild(); }

  new ResizeObserver(() => paintCanvas()).observe(stage);
  paintAll();
  rebuild().then(() => fitView());
  if (isNew) { projects.save({ id: rec.id, name: rec.name, doc: S.doc, thumb: "" }); templateModal(); }
  return { save, close: () => { clearTimeout(saveT); preview.dispose(); window.removeEventListener("keydown", onKey); } };
}

// ---------- small helpers ----------
const round = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function miniShape(paths, outline) {
  const b = bounds(paths); const s = Math.max(b.w, b.h) || 1;
  return h("svg", { viewBox: `${b.cx - s * 0.6} ${-b.cy - s * 0.6} ${s * 1.2} ${s * 1.2}`, "aria-hidden": "true" },
    h("path", { d: pathD(paths), fill: outline ? "none" : "currentColor", stroke: outline ? "currentColor" : "none", "stroke-width": s * 0.06, "stroke-dasharray": outline ? `${s * 0.1} ${s * 0.07}` : null }));
}
export { miniShape };
void UM;
