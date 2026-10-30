// Print files: a 3MF with one object made of coloured parts (Bambu Studio and Orca load it as one
// object, one part per filament) and a single-body STL.

export function stl(parts, title) {
  const n = parts.reduce((s, p) => s + p.tris.length / 9, 0);
  const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  const hdr = `Charleston3D ${title || ""}`.slice(0, 79);
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 127);
  dv.setUint32(80, n, true);
  let o = 84;
  for (const p of parts) {
    const t = p.tris;
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, t[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Blob([buf], { type: "model/stl" });
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function indexed(tris) {
  const map = new Map(); const verts = []; const faces = [];
  const id = (x, y, z) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let i = map.get(k);
    if (i === undefined) { i = verts.length / 3; map.set(k, i); verts.push(x, y, z); }
    return i;
  };
  for (let i = 0; i < tris.length; i += 9) {
    const a = id(tris[i], tris[i + 1], tris[i + 2]), b = id(tris[i + 3], tris[i + 4], tris[i + 5]), c = id(tris[i + 6], tris[i + 7], tris[i + 8]);
    if (a !== b && b !== c && a !== c) faces.push(a, b, c);
  }
  return { verts, faces };
}

export function threeMF(parts, title) {
  const mats = parts.map((p) => `<base name="${xml(p.filament)}" displaycolor="${p.color.toUpperCase()}FF"/>`).join("");
  let objects = "", comps = "";
  parts.forEach((p, i) => {
    const { verts, faces } = indexed(p.tris);
    let v = "", t = "";
    for (let k = 0; k < verts.length; k += 3) v += `<vertex x="${+verts[k].toFixed(4)}" y="${+verts[k + 1].toFixed(4)}" z="${+verts[k + 2].toFixed(4)}"/>`;
    for (let k = 0; k < faces.length; k += 3) t += `<triangle v1="${faces[k]}" v2="${faces[k + 1]}" v3="${faces[k + 2]}"/>`;
    const oid = i + 2;
    objects += `<object id="${oid}" name="${xml(`${p.name} (${p.filament})`)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    comps += `<component objectid="${oid}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xml(title)}</metadata><metadata name="Designer">Charleston3D</metadata><metadata name="Application">Charleston3D Maker Studio</metadata>
<resources><basematerials id="1">${mats}</basematerials>${objects}<object id="1" name="${xml(title)}" type="model">${"<components>" + comps + "</components>"}</object></resources>
<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build>
</model>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: "3D/3dmodel.model", data: model },
  ];
  return new Blob([zip(files)], { type: "model/3mf" });
}

// ---------- minimal ZIP (stored, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function zip(files) {
  const enc = new TextEncoder(); const chunks = []; const dir = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name); const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), 0, 0, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0]);
    chunks.push(head, name, data);
    dir.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), 0, 0, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), name);
    off += head.length + name.length + data.length;
  }
  const dirLen = dir.reduce((s, d) => s + d.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(dirLen), ...u32(off), 0, 0]);
  return new Blob([...chunks, ...dir, end]);
}

export function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = String(name).replace(/[\\/:*?"<>|]+/g, "-");
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
