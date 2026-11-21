/* Bambu Studio project file writer (Charleston 3D makers).
   Writes a .3mf the way Bambu Studio itself does, so it opens as a ready project: every plate laid out, every part
   already on its filament, the filament colours filled in, and the printer, nozzle and print preset chosen.
   Layout of the file (checked against Bambu Studio 2.08 exports):
     3D/3dmodel.model                 the objects (as lists of parts) and where each sits
     3D/Objects/object_N.model        the meshes of one object, one per part
     Metadata/model_settings.config   names, the filament (extruder) of every part, which plate holds what
     Metadata/project_settings.config printer, print and filament presets by their Bambu names, and the filament colours
     Metadata/plate_N.png             the picture Bambu Studio shows for the plate
   The printer and print settings are named, not copied: Bambu Studio fills them in from its own presets of those names
   (different_settings_to_system is empty). The filament settings are Bambu PLA Basic's own values, once per filament
   (bambu-presets.js), which is what makes each filament open as "Bambu PLA Basic" instead of a changed copy.
   Bambu Studio's command line can't read a project without every setting in it; to check a file there, change the
   Application line in 3D/3dmodel.model to anything not starting with "BambuStudio-" and it loads as a plain 3MF.
   Works in the browser (window.MakerBambu) and in Node 18+ (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MakerBambu = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  /* printer -> [Bambu model name, [bed x, bed y], height, {nozzle: [print preset, PLA Basic preset]}, how many nozzles], built by scripts/maker-presets.py */
  const PRINTERS = {"A1":["Bambu Lab A1",[256,256],256,{"0.8":["0.40mm Standard @BBL A1 0.8 nozzle","Bambu PLA Basic @BBL A1"],"0.4":["0.20mm Standard @BBL A1","Bambu PLA Basic @BBL A1"],"0.6":["0.30mm Strength @BBL A1 0.6 nozzle","Bambu PLA Basic @BBL A1"],"0.2":["0.10mm Standard @BBL A1 0.2 nozzle","Bambu PLA Basic @BBL A1 0.2 nozzle"]},1],"A1 mini":["Bambu Lab A1 mini",[180,180],180,{"0.6":["0.30mm Standard @BBL A1M 0.6 nozzle","Bambu PLA Basic @BBL A1M"],"0.4":["0.20mm Standard @BBL A1M","Bambu PLA Basic @BBL A1M"],"0.8":["0.40mm Standard @BBL A1M 0.8 nozzle","Bambu PLA Basic @BBL A1M"],"0.2":["0.10mm Standard @BBL A1M 0.2 nozzle","Bambu PLA Basic @BBL A1M 0.2 nozzle"]},1],"P1S":["Bambu Lab P1S",[256,256],250,{"0.2":["0.10mm Standard @BBL X1C 0.2 nozzle","Bambu PLA Basic @BBL X1C 0.2 nozzle"],"0.6":["0.30mm Standard @BBL X1C 0.6 nozzle","Bambu PLA Basic @BBL P1S 0.6 nozzle"],"0.8":["0.40mm Standard @BBL X1C 0.8 nozzle","Bambu PLA Basic @BBL X1C 0.8 nozzle"],"0.4":["0.20mm Standard @BBL X1C","Bambu PLA Basic @BBL P1S 0.4 nozzle"]},1],"P1P":["Bambu Lab P1P",[256,256],250,{"0.6":["0.30mm Standard @BBL P1P 0.6 nozzle","Bambu PLA Basic @BBL P1P 0.6 nozzle"],"0.8":["0.40mm Standard @BBL P1P 0.8 nozzle","Bambu PLA Basic @BBL P1P"],"0.4":["0.20mm Standard @BBL P1P","Bambu PLA Basic @BBL P1P"],"0.2":["0.10mm Standard @BBL P1P 0.2 nozzle","Bambu PLA Basic @BBL P1P 0.2 nozzle"]},1],"P2S":["Bambu Lab P2S",[256,256],256,{"0.8":["0.40mm Standard @BBL P2S 0.8 nozzle","Bambu PLA Basic @BBL P2S 0.8 nozzle"],"0.2":["0.10mm Standard @BBL P2S 0.2 nozzle","Bambu PLA Basic @BBL P2S 0.2 nozzle"],"0.6":["0.30mm Standard @BBL P2S 0.6 nozzle","Bambu PLA Basic @BBL P2S 0.6 nozzle"],"0.4":["0.20mm Standard @BBL P2S","Bambu PLA Basic @BBL P2S"]},1],"X1C":["Bambu Lab X1 Carbon",[256,256],250,{"0.2":["0.10mm Standard @BBL X1C 0.2 nozzle","Bambu PLA Basic @BBL X1C 0.2 nozzle"],"0.6":["0.30mm Standard @BBL X1C 0.6 nozzle","Bambu PLA Basic @BBL X1C 0.6 nozzle"],"0.4":["0.20mm Standard @BBL X1C","Bambu PLA Basic @BBL X1C"],"0.8":["0.40mm Standard @BBL X1C 0.8 nozzle","Bambu PLA Basic @BBL X1C 0.8 nozzle"]},1],"X1":["Bambu Lab X1",[256,256],250,{"0.4":["0.20mm Standard @BBL X1C","Bambu PLA Basic @BBL X1"],"0.8":["0.40mm Standard @BBL X1 0.8 nozzle","Bambu PLA Basic @BBL X1"],"0.2":["0.10mm Standard @BBL X1C 0.2 nozzle","Bambu PLA Basic @BBL X1C 0.2 nozzle"],"0.6":["0.30mm Standard @BBL X1 0.6 nozzle","Bambu PLA Basic @BBL X1"]},1],"X1E":["Bambu Lab X1E",[256,256],250,{"0.6":["0.30mm Standard @BBL X1C 0.6 nozzle","Bambu PLA Basic @BBL X1C"],"0.4":["0.20mm Standard @BBL X1C","Bambu PLA Basic @BBL X1C"],"0.2":["0.10mm Standard @BBL X1C 0.2 nozzle","Bambu PLA Basic @BBL X1C 0.2 nozzle"],"0.8":["0.40mm Standard @BBL X1C 0.8 nozzle","Bambu PLA Basic @BBL X1C 0.8 nozzle"]},1],"X2D":["Bambu Lab X2D",[256,256],261,{"0.4":["0.20mm Standard @BBL X2D","Bambu PLA Basic @BBL X2D 0.4 nozzle"],"0.6":["0.30mm Standard @BBL X2D 0.6 nozzle","Bambu PLA Basic @BBL X2D 0.6 nozzle"],"0.8":["0.40mm Standard @BBL X2D 0.8 nozzle","Bambu PLA Basic @BBL X2D 0.8 nozzle"],"0.2":["0.10mm Standard @BBL X2D 0.2 nozzle","Bambu PLA Basic @BBL X2D 0.2 nozzle"]},2],"H2D":["Bambu Lab H2D",[350,320],325,{"0.6":["0.30mm Standard @BBL H2D 0.6 nozzle","Bambu PLA Basic @BBL H2D 0.6 nozzle"],"0.2":["0.10mm Standard @BBL H2D 0.2 nozzle","Bambu PLA Basic @BBL H2D 0.2 nozzle"],"0.8":["0.40mm Standard @BBL H2D 0.8 nozzle","Bambu PLA Basic @BBL H2D 0.8 nozzle"],"0.4":["0.20mm Standard @BBL H2D","Bambu PLA Basic @BBL H2D"]},2],"H2D Pro":["Bambu Lab H2D Pro",[350,320],325,{"0.2":["0.10mm Standard @BBL H2DP 0.2 nozzle","Bambu PLA Basic @BBL H2DP 0.2 nozzle"],"0.8":["0.40mm Standard @BBL H2DP 0.8 nozzle","Bambu PLA Basic @BBL H2DP 0.8 nozzle"],"0.4":["0.20mm Standard @BBL H2DP","Bambu PLA Basic @BBL H2DP"],"0.6":["0.30mm Standard @BBL H2DP 0.6 nozzle","Bambu PLA Basic @BBL H2DP 0.6 nozzle"]},2],"H2C":["Bambu Lab H2C",[330,320],325,{"0.8":["0.40mm Standard @BBL H2C 0.8 nozzle","Bambu PLA Basic @BBL H2C 0.8 nozzle"],"0.2":["0.10mm Standard @BBL H2C 0.2 nozzle","Bambu PLA Basic @BBL H2C 0.2 nozzle"],"0.6":["0.30mm Standard @BBL H2C 0.6 nozzle","Bambu PLA Basic @BBL H2C 0.6 nozzle"],"0.4":["0.20mm Standard @BBL H2C","Bambu PLA Basic @BBL H2C"]},2],"H2S":["Bambu Lab H2S",[340,320],340,{"0.4":["0.20mm Standard @BBL H2S","Bambu PLA Basic @BBL H2S"],"0.8":["0.40mm Standard @BBL H2S 0.8 nozzle","Bambu PLA Basic @BBL H2S 0.8 nozzle"],"0.2":["0.10mm Standard @BBL H2S 0.2 nozzle","Bambu PLA Basic @BBL H2S 0.2 nozzle"],"0.6":["0.30mm Standard @BBL H2S 0.6 nozzle","Bambu PLA Basic @BBL H2S 0.6 nozzle"]},1],"A2L":["Bambu Lab A2L",[330,320],325,{"0.4":["0.20mm Standard @BBL A2L","Bambu PLA Basic @BBL A2L 0.4 nozzle"],"0.6":["0.30mm Standard @BBL A2L 0.6 nozzle","Bambu PLA Basic @BBL A2L 0.6 nozzle"],"0.2":["0.10mm Standard @BBL A2L 0.2 nozzle","Bambu PLA Basic @BBL A2L 0.2 nozzle"],"0.8":["0.40mm Standard @BBL A2L 0.8 nozzle","Bambu PLA Basic @BBL A2L 0.8 nozzle"]},1]};
  const VERSION = "01.07.04.52";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  const num = (v) => { const s = v.toFixed(4); return s.indexOf(".") < 0 ? s : s.replace(/0+$/, "").replace(/\.$/, ""); };
  const uuid = (a, b) => a.toString(16).padStart(8, "0") + "-" + b + "-4c3d-9a1b-c3d0a1b2c3d4";

  function preset(printer, nozzle) { const p = PRINTERS[printer] || PRINTERS.P1S, n = p[3][String(nozzle)] || p[3]["0.4"];
    return { key: PRINTERS[printer] ? printer : "P1S", model: p[0], bed: p[1], height: p[2], nozzles: p[4] || 1, nozzle: p[3][String(nozzle)] ? String(nozzle) : "0.4", machine: p[0] + " " + (p[3][String(nozzle)] ? String(nozzle) : "0.4") + " nozzle", print: n[0], filament: n[1] }; }

  /* presets: the pack in bambu-presets.js. Returns every setting of one preset ("filament" or "process"). */
  function presetValues(presets, kind, name) { const P = presets && presets[kind]; if (!P || !P.base) return {}; const out = {}, d = name === P.name ? {} : P.diff[name]; if (!d) return {};
    for (const k in P.base) if (!(k in d)) out[k] = P.base[k]; for (const k in d) if (d[k] !== null) out[k] = d[k]; return out; }

  /* how much to purge when the nozzle changes from one colour to another (mm3): going lighter needs far more than going darker */
  function flush(from, to) { const L = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; const d = Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]) / 441.7;
    return Math.max(110, Math.min(800, Math.round(140 + 560 * Math.max(0, L(to) - L(from)) + 140 * d))); }

  /* ---- zip, deflated ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflate(u8) { if (typeof CompressionStream === "undefined") return null;
    try { const cs = new CompressionStream("deflate-raw"), w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); } catch (e) { return null; } }
  /* files: [{name, data: string | Uint8Array, store?: true}] -> Uint8Array */
  async function zip(files) { const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    const le16 = (v) => [v & 255, (v >> 8) & 255], le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const f of files) { const name = enc.encode(f.name), raw = typeof f.data === "string" ? enc.encode(f.data) : f.data; const crc = crc32(raw);
      let data = raw, method = 0; if (!f.store && raw.length > 64) { const d = await deflate(raw); if (d && d.length < raw.length) { data = d; method = 8; } }
      const hdr = new Uint8Array([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(data.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...name]); parts.push(hdr, data);
      cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(data.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(off), ...name])); off += hdr.length + data.length; }
    const cdLen = cd.reduce((s, a) => s + a.length, 0); const end = new Uint8Array([0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(cdLen), ...le32(off), ...le16(0)]);
    const all = [...parts, ...cd, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of all) { out.set(a, o); o += a.length; } return out; }

  /* o: { title, printer, nozzle, objects: [{name, plate, plateName, parts: [{name, color: [r,g,b], verts, tris}]}], thumbs: {plateNumber: Uint8Array png} }
     Returns { bytes, filaments: [{color, hex, parts}], preset, plates }. Objects sharing a plate are set front to back, centred. */
  async function project(o) {
    const ps = preset(o.printer, o.nozzle), bed = ps.bed, fil = [], filOf = (c) => { const h = hex(c); let i = fil.findIndex((f) => f.hex === h); if (i < 0) { fil.push({ color: c, hex: h, parts: 0 }); i = fil.length - 1; } fil[i].parts++; return i + 1; };
    const plateIds = [...new Set(o.objects.map((x) => x.plate || 1))].sort((a, b) => a - b), cols = Math.max(1, Math.ceil(Math.sqrt(plateIds.length)));
    const files = [], res = [], items = [], cfgObj = [], cfgPlate = [], asm = [], rels = []; let id = 0, nObj = 0;
    plateIds.forEach((pid, pi) => { const list = o.objects.filter((x) => (x.plate || 1) === pid), gap = 8;
      for (const x of list) { const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]; for (const p of x.parts) for (let k = 0; k < p.verts.length; k += 3) { const X = p.verts[k], Y = p.verts[k + 1], Z = p.verts[k + 2]; if (X < b[0]) b[0] = X; if (X > b[1]) b[1] = X; if (Y < b[2]) b[2] = Y; if (Y > b[3]) b[3] = Y; if (Z < b[4]) b[4] = Z; if (Z > b[5]) b[5] = Z; } x._b = b; }
      const tot = list.reduce((s, x) => s + (x._b[3] - x._b[2]), 0) + gap * (list.length - 1); let top = bed[1] / 2 + tot / 2;
      const ox = (pi % cols) * bed[0] * 1.2, oy = -Math.floor(pi / cols) * bed[1] * 1.2, inst = [];
      for (const x of list) { const b = x._b, cx = (b[0] + b[1]) / 2, cy = (b[2] + b[3]) / 2, h = b[3] - b[2]; nObj++;
        const comps = [], pc = [], body = [];
        for (const p of x.parts) { const pidN = ++id, V = p.verts, T = p.tris, v = new Array(V.length / 3), t = new Array(T.length / 3);
          for (let k = 0, i = 0; k < V.length; k += 3, i++) v[i] = '<vertex x="' + num(V[k] - cx) + '" y="' + num(V[k + 1] - cy) + '" z="' + num(V[k + 2] - b[4]) + '"/>';
          for (let k = 0, i = 0; k < T.length; k += 3, i++) t[i] = '<triangle v1="' + T[k] + '" v2="' + T[k + 1] + '" v3="' + T[k + 2] + '"/>';
          body.push('  <object id="' + pidN + '" p:UUID="' + uuid(pidN, "81cb") + '" type="model">\n   <mesh>\n    <vertices>\n' + v.join("\n") + '\n    </vertices>\n    <triangles>\n' + t.join("\n") + '\n    </triangles>\n   </mesh>\n  </object>\n');
          comps.push('    <component p:path="/3D/Objects/object_' + nObj + '.model" objectid="' + pidN + '" p:UUID="' + uuid(pidN, "b206") + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>');
          pc.push('    <part id="' + pidN + '" subtype="normal_part">\n      <metadata key="name" value="' + esc(p.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="extruder" value="' + filOf(p.color) + '"/>\n      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>'); }
        const oid = ++id, file = "3D/Objects/object_" + nObj + ".model";
        files.push({ name: file, data: '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' + body.join("") + ' </resources>\n <build/>\n</model>\n' });
        rels.push('<Relationship Target="/' + file + '" Id="rel-' + nObj + '" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>');
        res.push('  <object id="' + oid + '" p:UUID="' + uuid(oid, "61cb") + '" type="model">\n   <components>\n' + comps.join("\n") + '\n   </components>\n  </object>');
        const tx = ox + bed[0] / 2, ty = oy + top - h / 2; top -= h + gap; const tr = "1 0 0 0 1 0 0 0 1 " + num(tx) + " " + num(ty) + " 0";
        items.push('  <item objectid="' + oid + '" p:UUID="' + uuid(oid, "b1ec") + '" transform="' + tr + '" printable="1"/>');
        cfgObj.push('  <object id="' + oid + '">\n    <metadata key="name" value="' + esc(x.name) + '"/>\n    <metadata key="extruder" value="' + filOf(x.parts[0].color) + '"/>\n' + pc.join("\n") + '\n  </object>'); fil[fil.findIndex((f) => f.hex === hex(x.parts[0].color))].parts--;
        inst.push('    <model_instance>\n      <metadata key="object_id" value="' + oid + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + (100 + oid) + '"/>\n    </model_instance>');
        asm.push('   <assemble_item object_id="' + oid + '" instance_id="0" transform="' + tr + '" offset="0 0 0" />'); delete x._b; }
      const thumb = o.thumbs && o.thumbs[pid];
      cfgPlate.push('  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value="' + esc(list[0].plateName || "") + '"/>\n    <metadata key="locked" value="false"/>\n' + (thumb ? '    <metadata key="thumbnail_file" value="Metadata/plate_' + (pi + 1) + '.png"/>\n' : "") + inst.join("\n") + '\n  </plate>');
      if (thumb) files.push({ name: "Metadata/plate_" + (pi + 1) + ".png", data: thumb, store: true }); });
    const n = fil.length, same = (v) => fil.map(() => v), matrix = []; for (let e = 0; e < ps.nozzles; e++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) matrix.push(a === b ? "0" : String(flush(fil[a].color, fil[b].color)));
    const settings = { printer_model: ps.model, printer_settings_id: ps.machine, printer_variant: ps.nozzle, nozzle_diameter: Array(ps.nozzles).fill(ps.nozzle), print_settings_id: ps.print, filament_settings_id: same(ps.filament), filament_colour: fil.map((f) => f.hex), filament_ids: same("GFA00"),
      different_settings_to_system: ["", ...same(""), ""], flush_volumes_matrix: matrix, flush_volumes_vector: fil.flatMap(() => ["140", "140"]), flush_multiplier: Array(ps.nozzles).fill("1"), curr_bed_type: "Textured PEI Plate" };
    /* the filament's own settings, once per filament, exactly as Bambu Studio's preset has them, so every filament opens as
       "Bambu PLA Basic" and not as a changed copy (checked in Bambu Studio 2.08) */
    const fp = presetValues(o.presets, "filament", ps.filament); for (const k in fp) { const v = fp[k]; if (!Array.isArray(v)) continue; let all = []; for (let i = 0; i < n; i++) all = all.concat(v); settings[k] = all; }
    const hasThumb = files.some((f) => f.name === "Metadata/plate_1.png");
    const model = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n <metadata name="Application">BambuStudio-' + VERSION + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + esc(o.title || "") + '</metadata>\n <metadata name="Designer">Charleston 3D Maker</metadata>\n' + (hasThumb ? ' <metadata name="Thumbnail_Middle">/Metadata/plate_1.png</metadata>\n <metadata name="Thumbnail_Small">/Metadata/plate_1.png</metadata>\n' : "") + ' <resources>\n' + res.join("\n") + '\n </resources>\n <build p:UUID="' + uuid(1, "22b5") + '">\n' + items.join("\n") + '\n </build>\n</model>\n';
    const out = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="config" ContentType="text/xml"/>\n</Types>\n' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' + (hasThumb ? ' <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n <Relationship Target="/Metadata/plate_1.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>\n' : "") + '</Relationships>\n' },
      { name: "3D/3dmodel.model", data: model },
      { name: "3D/_rels/3dmodel.model.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n ' + rels.join("\n ") + '\n</Relationships>\n' },
      ...files,
      { name: "Metadata/model_settings.config", data: '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + cfgObj.join("\n") + "\n" + cfgPlate.join("\n") + '\n  <assemble>\n' + asm.join("\n") + '\n  </assemble>\n</config>\n' },
      { name: "Metadata/project_settings.config", data: JSON.stringify(settings, null, 4) },
    ];
    return { bytes: await zip(out), filaments: fil, preset: ps, plates: plateIds.length };
  }

  /* binary STL from a mesh {verts, tris} */
  function stl(mesh, name) { const T = mesh.tris, V = mesh.verts, n = T.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); const h = ("Charleston 3D maker " + (name || "")).slice(0, 79); for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 127); dv.setUint32(80, n, true);
    let o = 84; for (let i = 0; i < T.length; i += 3) { const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3; const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
      for (const q of [a, b, c]) { dv.setFloat32(o, V[q], true); dv.setFloat32(o + 4, V[q + 1], true); dv.setFloat32(o + 8, V[q + 2], true); o += 12; } o += 2; }
    return new Uint8Array(buf); }

  return { PRINTERS, preset, project, zip, stl, flush, hex, presetValues };
});
