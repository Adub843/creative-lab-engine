// Reads STL, 3MF and OBJ files in the browser and draws a shaded preview picture of them, so the
// Charleston 3D file library can show what each print file is. No 3D library needed: a small
// software renderer (depth buffer, one light) draws the triangles onto a canvas.

// Each reader returns a list of parts: { name, tri: Float32Array of x,y,z for every triangle corner }.
function parseStl(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const binary = u8.length >= 84 && u8.length === 84 + dv.getUint32(80, true) * 50;
  if (!binary) {
    const v = [];
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    for (let m; (m = re.exec(new TextDecoder().decode(u8)));) v.push(+m[1], +m[2], +m[3]);
    return [{ name: "part", tri: new Float32Array(v) }];
  }
  const n = dv.getUint32(80, true);
  const tri = new Float32Array(n * 9);
  for (let t = 0, o = 84; t < n; t++) {
    o += 12;
    for (let k = 0; k < 9; k++, o += 4) tri[t * 9 + k] = dv.getFloat32(o, true);
    o += 2;
  }
  return [{ name: "part", tri }];
}

async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not a zip");
  const out = {}, td = new TextDecoder();
  let p = dv.getUint32(end + 16, true);
  for (let i = 0, n = dv.getUint16(end + 10, true); i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const data = u8.subarray(start, start + size);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  }
  return out;
}

async function parse3mf(buf) {
  const z = await unzip(buf);
  const key = Object.keys(z).find((k) => /3dmodel\.model$/i.test(k)) ?? Object.keys(z).find((k) => /\.model$/i.test(k));
  if (!key) throw new Error("no model inside the 3MF");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(z[key]), "application/xml");
  const parts = [];
  doc.querySelectorAll("object").forEach((ob) => {
    const mesh = ob.querySelector("mesh");
    if (!mesh) return;
    const vs = [...mesh.querySelectorAll("vertex")].map((v) => [+v.getAttribute("x"), +v.getAttribute("y"), +v.getAttribute("z")]);
    const ts = [...mesh.querySelectorAll("triangle")];
    const tri = new Float32Array(ts.length * 9);
    ts.forEach((t, i) => ["v1", "v2", "v3"].forEach((a, k) => tri.set(vs[+t.getAttribute(a)] ?? [0, 0, 0], i * 9 + k * 3)));
    parts.push({ name: ob.getAttribute("name") || `part ${parts.length + 1}`, tri });
  });
  if (!parts.length) throw new Error("no meshes in the 3MF");
  return parts;
}

function parseObj(buf) {
  const v = [], tri = [];
  for (const line of new TextDecoder().decode(buf).split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "v") v.push([+f[1], +f[2], +f[3]]);
    else if (f[0] === "f") {
      const idx = f.slice(1).map((s) => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
      for (let k = 1; k + 1 < idx.length; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) tri.push(...(v[i] ?? [0, 0, 0]));
    }
  }
  return [{ name: "part", tri: new Float32Array(tri) }];
}

export const canPreview = (name) => /\.(stl|3mf|obj)$/i.test(name);

export async function readModel(name, buf) {
  if (/\.3mf$/i.test(name)) return parse3mf(buf);
  if (/\.obj$/i.test(name)) return parseObj(buf);
  return parseStl(buf);
}

function bounds(parts) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.tri.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p.tri[i + k];
    if (v < mn[k]) mn[k] = v;
    if (v > mx[k]) mx[k] = v;
  }
  return { mn, mx, size: mx.map((v, i) => v - mn[i]) };
}

// Charleston 3D colors for multi-part files: teal, navy, sand, brass, then the Rainbow Row pastels.
const COLORS = [[14, 124, 116], [29, 53, 102], [216, 196, 160], [184, 137, 42], [232, 166, 160], [160, 196, 220]];

// A shaded picture of the model from a three-quarter view; returns the canvas and the size in mm.
export function renderModel(parts, W = 480, H = 360) {
  const bb = bounds(parts);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#f5f1e8"); g.addColorStop(1, "#e2dacb");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H), px = img.data;
  const zb = new Float32Array(W * H).fill(-Infinity);
  const c = [0, 1, 2].map((k) => (bb.mn[k] + bb.mx[k]) / 2);
  const yaw = -0.6, tilt = 0.55, cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  const R = Math.hypot(...bb.size) / 2 || 1, sc = Math.min(W, H) * 0.44 / R, L = [0.35, -0.5, 0.79];
  const proj = (x, y, z, o) => {
    x -= c[0]; y -= c[1]; z -= c[2];
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    o[0] = W / 2 + x1 * sc; o[1] = H / 2 - (y1 * st + z * ct) * sc; o[2] = y1 * ct - z * st;
  };
  const a = [0, 0, 0], b = [0, 0, 0], d = [0, 0, 0];
  parts.forEach((p, pi) => {
    const col = COLORS[pi % COLORS.length], T = p.tri;
    for (let i = 0; i + 8 < T.length; i += 9) {
      proj(T[i], T[i + 1], T[i + 2], a); proj(T[i + 3], T[i + 4], T[i + 5], b); proj(T[i + 6], T[i + 7], T[i + 8], d);
      const ux = T[i + 3] - T[i], uy = T[i + 4] - T[i + 1], uz = T[i + 5] - T[i + 2], vx = T[i + 6] - T[i], vy = T[i + 7] - T[i + 1], vz = T[i + 8] - T[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const ny1 = nx * sy + ny * cy, nx1 = nx * cy - ny * sy;
      const sh = 0.35 + 0.65 * Math.abs(nx1 * L[0] + (ny1 * ct - nz * st) * L[1] + (ny1 * st + nz * ct) * L[2]);
      const r = col[0] * sh, gg = col[1] * sh, bl = col[2] * sh;
      const minx = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], d[0])));
      const miny = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], d[1])));
      const det = (b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]);
      if (minx > maxx || miny > maxy || Math.abs(det) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const w1 = ((x - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (y - a[1])) / det;
        const w2 = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / det;
        const w0 = 1 - w1 - w2;
        if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
        const z = -(w0 * a[2] + w1 * b[2] + w2 * d[2]), k = y * W + x;
        if (z > zb[k]) { zb[k] = z; px[k * 4] = r; px[k * 4 + 1] = gg; px[k * 4 + 2] = bl; }
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return { canvas: cv, size: bb.size };
}
