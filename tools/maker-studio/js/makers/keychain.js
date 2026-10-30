// Name keychain: raised lettering on a plate that follows the letters (or a pill or tag), with a ring
// hole, in up to three filament colours stacked base → outline → letters.
import { FONTS, loadFont, textPaths, offset, solidOutline, islands, union, subtract, bounds, rect, roundRect, circle, extrude } from "../geom.js";
import { filament, RULES, strokeCheck, sizeCheck } from "../print.js";

export default {
  id: "keychain",
  name: "Name keychain",
  blurb: "A name or word with a ring hole, in two or three colours.",
  icon: "M7 12a5 5 0 1 1 5 5M12 17h8M17 17v3M20 17v2",
  sections: [
    { title: "Text", fields: [
      { key: "text", type: "text", label: "Name or word", max: 24, lines: 2 },
      { key: "font", type: "font", label: "Font" },
      { key: "size", type: "range", label: "Letter height", unit: "mm", min: 6, max: 30, step: 0.5 },
      { key: "spacing", type: "range", label: "Letter spacing", unit: "mm", min: -1.5, max: 4, step: 0.1 },
    ] },
    { title: "Shape", fields: [
      { key: "shape", type: "segment", label: "Base", options: [["outline", "Follows letters"], ["pill", "Pill"], ["tag", "Tag"]] },
      { key: "border", type: "range", label: "Border", unit: "mm", min: 1.5, max: 8, step: 0.25 },
      { key: "ring", type: "segment", label: "Ring hole", options: [["left", "Left"], ["top", "Top"], ["right", "Right"], ["none", "None"]] },
      { key: "hole", type: "range", label: "Hole size", unit: "mm", min: 3, max: 8, step: 0.25, show: (v) => v.ring !== "none" },
    ] },
    { title: "Layers", fields: [
      { key: "baseT", type: "range", label: "Base thickness", unit: "mm", min: 1.6, max: 6, step: 0.2 },
      { key: "outline", type: "toggle", label: "Outline layer" },
      { key: "outlineT", type: "range", label: "Outline height", unit: "mm", min: 0.4, max: 2, step: 0.2, show: (v) => v.outline },
      { key: "textT", type: "range", label: "Letter height above base", unit: "mm", min: 0.4, max: 3, step: 0.2 },
    ] },
    { title: "Colours", fields: [
      { key: "baseColor", type: "filament", label: "Base" },
      { key: "outlineColor", type: "filament", label: "Outline", show: (v) => v.outline },
      { key: "textColor", type: "filament", label: "Letters" },
    ] },
  ],
  defaults: {
    text: "Charleston", font: "pacifico", size: 12, spacing: 0, shape: "outline", border: 3, ring: "left", hole: 4.5,
    baseT: 3, outline: true, outlineT: 0.8, textT: 1.2, baseColor: "navy", outlineColor: "white", textColor: "teal",
  },

  tests: [{}, { text: "Big Mike", font: "anton", shape: "outline" }, { text: "Ava\nRose", shape: "pill", ring: "top" },
    { text: "Tiny", size: 4, font: "marker" }, { text: "Lowcountry", shape: "tag", ring: "right", outline: false }],

  async build(v) {
    const font = await loadFont(v.font);
    const text = String(v.text || "").trim() || "Name";
    const T = textPaths(font, text, v.size, { spacing: v.spacing });
    const tb = bounds(T);
    const checks = [];

    // base outline
    let base;
    if (v.shape === "pill") {
      const h = tb.h + 2 * v.border; base = roundRect(tb.x0 - v.border - h * 0.15, tb.y0 - v.border, tb.x1 + v.border + h * 0.15, tb.y1 + v.border, h / 2);
    } else if (v.shape === "tag") {
      base = roundRect(tb.x0 - v.border * 1.4, tb.y0 - v.border, tb.x1 + v.border * 1.4, tb.y1 + v.border, Math.min(4, v.border * 1.2));
    } else {
      base = solidOutline(offset(T, v.border));
      if (islands(base) > 1) { // join separate words or letters with a bar through the middle
        const bar = Math.max(3, v.size * 0.45);
        base = solidOutline(offset(offset(union(base, rect(tb.x0, tb.cy - bar / 2, tb.x1, tb.cy + bar / 2)), 0.8), -0.8));
      }
    }

    // ring tab
    let hole = null;
    if (v.ring !== "none") {
      const r = v.hole / 2, R = r + Math.max(2.4, v.border * 0.8);
      const bb = bounds(base);
      const side = v.ring;
      const cx = side === "left" ? bb.x0 - r + 0.4 : side === "right" ? bb.x1 + r - 0.4 : tb.cx;
      const cy = side === "top" ? bb.y1 + r - 0.4 : tb.cy;
      let tab = circle(cx, cy, R);
      for (let reach = v.border + v.size * 0.3, i = 0; i < 8; i++, reach += v.size * 0.4) {
        const bridge = side === "left" ? rect(cx, cy - R * 0.85, bb.x0 + reach, cy + R * 0.85)
          : side === "right" ? rect(bb.x1 - reach, cy - R * 0.85, cx, cy + R * 0.85)
          : rect(cx - R * 0.85, bb.y1 - reach, cx + R * 0.85, cy);
        const joined = union(base, tab, bridge);
        if (islands(joined) === 1) { base = solidOutline(offset(offset(joined, -0.6), 0.6)); break; }
        if (i === 7) base = joined;
      }
      hole = circle(cx, cy, r);
      base = subtract(base, hole);
    }

    const parts = [];
    const add = (name, paths, z0, z1, colorId) => {
      const f = filament(colorId);
      parts.push({ name, filament: f.name, color: f.hex, z0, z1, paths, tris: extrude(paths, z0, z1) });
    };
    let z = v.baseT;
    add("Base", base, 0, z, v.baseColor);
    if (v.outline) {
      let ol = solidOutline(offset(T, Math.max(1.2, v.border * 0.45)));
      if (hole) ol = subtract(ol, offset(hole, 1.2));
      add("Outline", ol, z, z + v.outlineT, v.outlineColor); z += v.outlineT;
    }
    add("Letters", T, z, z + v.textT, v.textColor); z += v.textT;

    // checks
    checks.push(strokeCheck(T, "The lettering"));
    checks.push(v.size >= RULES.minCap ? { level: "ok", text: `Letters are ${v.size} mm tall, easy to read.` } : { level: "warn", text: `Letters under ${RULES.minCap} mm are hard to read.` });
    checks.push(v.textT >= RULES.minLayer ? { level: "ok", text: `Raised letters are ${v.textT} mm (${Math.round(v.textT / 0.2)} layers).` } : { level: "warn", text: `Raised letters under ${RULES.minLayer} mm barely show. Use ${RULES.minLayer} mm or more.` });
    checks.push(v.baseT >= 2.4 ? { level: "ok", text: `Base is ${v.baseT} mm thick, strong enough for keys.` } : { level: "warn", text: `A base under 2.4 mm can snap at the ring on a key ring.` });
    if (islands(base) > 1) checks.push({ level: "bad", text: "The base is in more than one piece. Turn up the border or use Pill or Tag." });
    checks.push(sizeCheck(base, z));
    return { parts, checks, title: `${text} keychain` };
  },
};

export { FONTS };
