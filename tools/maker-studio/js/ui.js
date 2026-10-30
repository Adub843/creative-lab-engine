// Small DOM helpers shared by every screen.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export function h(tag, attrs = {}, ...kids) {
  const svgTags = /^(svg|path|g|circle|rect|line|polyline|polygon|defs|clipPath|pattern|text)$/;
  const e = svgTags.test(tag) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k);
  return e;
}

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode or full */ } },
};

export function toast(msg) {
  let box = $("#toasts");
  if (!box) { box = h("div", { id: "toasts", class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: "toast" }, msg); box.append(t); setTimeout(() => t.remove(), 3500);
}

// Static inline icons for the editor chrome (our own line drawings).
const I = {
  back: "M15 5l-7 7 7 7",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 10h.01M15 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0",
  shape: "M12 3l4 7H8zM4 14h7v7H4zM17.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  svg: "M4 19l5-7 4 5 3-4 4 6zM4 4h16v16H4zM15.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  hole: "M12 20c4.4 0 8-3.6 8-8s-3.6-8-8-8-8 3.6-8 8 3.6 8 8 8zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  plate: "M3 9l9-5 9 5-9 5zM3 9v4l9 5 9-5V9",
  thick: "M4 12h16M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3",
  select: "M5 3l14 8-6 2-3 6z",
  pan: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-2.7L3 15a1.6 1.6 0 0 1 2.6-1.8L8 15",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  paste: "M9 4h6v3H9zM15 5h3v15H6V5h3M10 12h6M10 16h4",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  plus: "M12 5v14M5 12h14",
  down: "M6 9l6 6 6-6",
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
  alignL: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignC: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignR: "M4 6h16M10 10h10M4 14h16M10 18h10",
  lineGap: "M12 3v18M9 6l3-3 3 3M9 18l3 3 3-3M4 12h4M16 12h4",
  curve: "M3 17c4-8 14-8 18 0",
  fwd: "M5 14h14v6H5zM12 11V3M8.5 6.5L12 3l3.5 3.5",
  bwd: "M5 4h14v6H5zM12 13v8M8.5 17.5L12 21l3.5-3.5",
  font: "M4 20l6-16h1l6 16M7 14h7",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8",
  rotate: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
};
export function icon(name, cls = "ico") {
  return h("svg", { class: cls, viewBox: "0 0 24 24", "aria-hidden": "true" },
    h("path", { d: I[name] || "", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }));
}

export function slug(s) { return String(s || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "design"; }

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h("input", { type: "file", accept, style: "display:none" });
    inp.addEventListener("change", () => { resolve(inp.files && inp.files[0] || null); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

// Clipper outlines (mm, y up) -> SVG path data in canvas space (mm, y down).
export function pathD(paths) {
  let d = "";
  for (const p of paths) {
    if (p.length < 3) continue;
    d += "M" + p.map((q) => `${(q.X / 1000).toFixed(2)} ${(-q.Y / 1000).toFixed(2)}`).join("L") + "Z";
  }
  return d;
}

// Length display in the chosen units.
export const UNITS = { mm: { k: 1, step: 0.5, dp: 1 }, cm: { k: 0.1, step: 0.05, dp: 2 }, in: { k: 1 / 25.4, step: 0.02, dp: 2 } };
export function fmt(mm, u = "mm") { const U = UNITS[u] || UNITS.mm; return `${(+mm * U.k).toFixed(U.dp).replace(/\.?0+$/, "")} ${u}`; }
