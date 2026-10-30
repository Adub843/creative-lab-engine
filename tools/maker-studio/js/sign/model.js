// Sign documents: a fresh blank, our templates, and the saved-projects list ("My list") kept in this browser.
export const MAX_PROJECTS = 30;
const KEY = "ms-sign-projects";
const uid = () => Math.random().toString(36).slice(2, 10);
export { uid };

export function blank() {
  return {
    v: 1, name: "My sign", units: "mm", showBed: true,
    plate: { style: "rect", w: 150, h: 100, r: 10, color: "white", margin: 4, border: { weight: "medium", color: "black", offset: 2 } },
    thick: { base: 2, text: 0.6, svg: 0.6, shape: 0.6 }, facedown: false,
    holes: [], lockHoles: false, hideHoles: false,
    els: [],
  };
}

const T = (o) => ({ id: uid(), kind: "text", x: 0, y: 0, rot: 0, color: "black", font: "montserrat", size: 12, bold: false, align: "center", lineGap: 0.25, spacing: 0, curve: 0, ...o });
const I = (o) => ({ id: uid(), kind: "icon", x: 0, y: 0, rot: 0, color: "black", size: 20, filled: false, ...o });

// Our own starting designs.
export const TEMPLATES = [
  { id: "door", name: "Door hanger", make: () => ({ ...blank(), name: "Door hanger",
    plate: { ...blank().plate, style: "tagLong", w: 90, h: 230, r: 45, color: "navy", border: { weight: "thin", color: "white", offset: 3 } },
    holes: [{ id: uid(), type: "inside", x: 0, y: -80, d: 42 }],
    els: [T({ text: "PLEASE\nKNOCK", y: 10, size: 11, color: "white" }), I({ name: "door", y: 60, size: 26, color: "white" })] }) },
  { id: "parking", name: "Parking sign", make: () => ({ ...blank(), name: "Parking sign",
    plate: { ...blank().plate, w: 180, h: 120, r: 8, color: "blue", border: { weight: "thick", color: "white", offset: 4 } },
    holes: [{ id: uid(), type: "inside", x: -75, y: -45, d: 5 }, { id: uid(), type: "inside", x: 75, y: -45, d: 5 }],
    els: [T({ text: "RESERVED\nPARKING", y: 0, size: 16, color: "white" })] }) },
  { id: "luggage", name: "Luggage tag", make: () => ({ ...blank(), name: "Luggage tag",
    plate: { ...blank().plate, w: 95, h: 58, r: 6, color: "orange", border: { weight: "none", color: "white", offset: 2 } },
    holes: [{ id: uid(), type: "inside", x: -38, y: 0, d: 7 }],
    els: [T({ text: "THIS BAG BELONGS TO", y: -16, x: 6, size: 4.5, color: "white" }), T({ text: "Your Name", y: 4, x: 6, size: 9, color: "white", font: "righteous" })] }) },
  { id: "desk", name: "Desk nameplate", make: () => ({ ...blank(), name: "Desk nameplate",
    plate: { ...blank().plate, w: 200, h: 50, r: 4, color: "black", border: { weight: "thin", color: "gold", offset: 3 } },
    els: [T({ text: "Your Name", y: -4, size: 14, color: "gold", font: "montserrat" }), T({ text: "Title", y: 13, size: 6, color: "white" })] }) },
  { id: "pet", name: "Pet tag", make: () => ({ ...blank(), name: "Pet tag",
    plate: { ...blank().plate, style: "bone", w: 60, h: 30, color: "red", border: { weight: "none", color: "white", offset: 2 } },
    holes: [{ id: uid(), type: "boundary", x: -34, y: 0, d: 4.5 }],
    els: [T({ text: "Buddy", size: 9, color: "white", font: "righteous" })] }) },
  { id: "house", name: "House number", make: () => ({ ...blank(), name: "House number",
    plate: { ...blank().plate, style: "arch", w: 140, h: 170, color: "white", border: { weight: "medium", color: "navy", offset: 5 } },
    thick: { base: 4, text: 1, svg: 1, shape: 1 },
    holes: [{ id: uid(), type: "back", x: 0, y: -50, d: 8 }],
    els: [T({ text: "1842", y: 5, size: 36, color: "navy", font: "bebas" }), I({ name: "home", y: -45, size: 22, color: "navy" })] }) },
  { id: "wifi", name: "Wi-Fi sign", make: () => ({ ...blank(), name: "Wi-Fi sign",
    plate: { ...blank().plate, w: 110, h: 110, r: 12, color: "white", border: { weight: "thin", color: "teal", offset: 3 } },
    els: [I({ name: "wifi", y: -22, size: 34, color: "teal" }), T({ text: "Network", y: 16, size: 7 }), T({ text: "Password", y: 32, size: 7 })] }) },
  { id: "keychain", name: "Round keychain", make: () => ({ ...blank(), name: "Round keychain",
    plate: { ...blank().plate, style: "circle", w: 45, h: 45, color: "teal", border: { weight: "thin", color: "white", offset: 2 } },
    thick: { base: 3, text: 1, svg: 1, shape: 1 },
    holes: [{ id: uid(), type: "boundary", x: 0, y: -24, d: 4.5 }],
    els: [T({ text: "AB", size: 14, color: "white", font: "bungee" })] }) },
];

export const HOLE_PRESETS = [
  { id: "top", name: "Single, top" }, { id: "left", name: "Single, left" }, { id: "right", name: "Single, right" },
  { id: "topPair", name: "Two, top corners" }, { id: "corners", name: "Four corners" },
];
export const HOLE_SIZES = [3, 4, 4.5, 5, 6, 8, 10];

export function presetHoles(doc, preset, type, d) {
  const P = doc.plate; const w = P.style === "none" || P.style === "outline" ? 60 : P.w, h = P.style === "none" || P.style === "outline" ? 40 : P.h;
  const inset = type === "boundary" ? -(d / 2 + 0.4) : Math.max(d, 6);
  const at = (x, y) => ({ id: uid(), type, x, y, d });
  const ix = w / 2 - inset, iy = h / 2 - inset;
  switch (preset) {
    case "left": return [at(-ix, 0)];
    case "right": return [at(ix, 0)];
    case "topPair": return [at(-ix, -iy), at(ix, -iy)];
    case "corners": return [at(-ix, -iy), at(ix, -iy), at(-ix, iy), at(ix, iy)];
    default: return [at(0, type === "back" ? -h / 2 + Math.max(15, d * 2.5) : -iy)];
  }
}

// ---------- My list ----------
function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
  catch { return false; }
}
export const projects = {
  list() { return read().sort((a, b) => b.updated - a.updated); },
  get(id) { return read().find((p) => p.id === id) || null; },
  save(p) {
    const list = read(); const i = list.findIndex((x) => x.id === p.id);
    const rec = { ...p, updated: Date.now() };
    if (i >= 0) list[i] = rec; else list.push(rec);
    return write(list) ? rec : null;
  },
  remove(id) { write(read().filter((p) => p.id !== id)); },
  full() { return read().length >= MAX_PROJECTS; },
};
