// Filaments and print checks shared by every maker.
import { opening, area, bounds } from "./geom.js";

export const FILAMENTS = [
  { id: "white", name: "White", hex: "#f2f1ec" },
  { id: "black", name: "Black", hex: "#1c1d20" },
  { id: "gray", name: "Gray", hex: "#8b8d8f" },
  { id: "silver", name: "Silver", hex: "#a9acb0" },
  { id: "red", name: "Red", hex: "#c3242c" },
  { id: "orange", name: "Orange", hex: "#ee6d2a" },
  { id: "yellow", name: "Yellow", hex: "#f3c316" },
  { id: "green", name: "Green", hex: "#1f9a4b" },
  { id: "teal", name: "Teal", hex: "#0e7c74" },
  { id: "lightblue", name: "Light blue", hex: "#5aa4dc" },
  { id: "blue", name: "Blue", hex: "#1f4fae" },
  { id: "navy", name: "Navy", hex: "#1f2b50" },
  { id: "purple", name: "Purple", hex: "#5d3fa6" },
  { id: "pink", name: "Pink", hex: "#ef93b8" },
  { id: "gold", name: "Gold", hex: "#c09437" },
  { id: "brown", name: "Brown", hex: "#6f4528" },
];
export const filament = (id) => FILAMENTS.find((f) => f.id === id) || FILAMENTS[0];

// The rules every file has to pass before it's offered for download (0.4 mm nozzle, 0.2 mm layers).
export const RULES = {
  minStroke: 1.0,  // thinnest printed line, mm (2.5 nozzle widths)
  minWall: 1.2,    // thinnest wall or bridge that holds weight, mm
  minLayer: 0.6,   // thinnest raised or inset detail, mm (3 layers)
  minCap: 5,       // smallest readable letter height, mm
  bed: 250,        // largest side that fits a Bambu X1/P1/A1 bed with margin, mm
};

// How much of a shape disappears when everything thinner than `w` is removed.
export function thinShare(paths, w) {
  const a = area(paths);
  if (a <= 0) return 0;
  return Math.max(0, 1 - area(opening(paths, w)) / a);
}

export function strokeCheck(paths, label) {
  const lost = thinShare(paths, RULES.minStroke);
  if (lost > 0.06) return { level: "bad", text: `${label} has lines thinner than ${RULES.minStroke} mm. Make it bigger or pick a bolder font.` };
  if (lost > 0.015) return { level: "warn", text: `A few thin spots in ${label.toLowerCase()} will print soft. Bigger text prints cleaner.` };
  return { level: "ok", text: `${label} lines are all at least ${RULES.minStroke} mm wide.` };
}

export function sizeCheck(paths, depth) {
  const b = bounds(paths);
  const big = Math.max(b.w, b.h);
  if (big > RULES.bed) return { level: "bad", text: `It's ${big.toFixed(0)} mm long, bigger than the ${RULES.bed} mm bed.` };
  return { level: "ok", text: `${b.w.toFixed(1)} × ${b.h.toFixed(1)} × ${depth.toFixed(1)} mm, fits the bed.` };
}
