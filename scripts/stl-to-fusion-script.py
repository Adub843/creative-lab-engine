"""Turns a flat-layered STL (ornaments, cookie cutters, signs: every side straight up, every top flat) into a
Fusion script job that rebuilds it as a real, editable Fusion design: one sketch and one extrusion per layer.
  python scripts/stl-to-fusion-script.py <model.stl> <job name> <out.json>
Needs trimesh and shapely (pip install trimesh shapely). Checks that the model really is flat-layered first."""
import json, sys
import numpy as np, trimesh
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

src, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
m = trimesh.load(src, force="mesh")
n = m.face_normals
flat = np.abs(n[:, 2]) > 0.999
if (~flat & (np.abs(n[:, 2]) > 0.01)).any():
    sys.exit("Not flat-layered: it has sloped faces, so use the resize recipe (open and save) instead.")
m.apply_translation([-(m.bounds[0][0] + m.bounds[1][0]) / 2, -(m.bounds[0][1] + m.bounds[1][1]) / 2, -m.bounds[0][2]])
levels = sorted(set(np.round(m.triangles_center[flat][:, 2], 3).tolist()))
layers = []
for z0, z1 in zip(levels, levels[1:]):
    sec = m.section(plane_origin=[0, 0, (z0 + z1) / 2], plane_normal=[0, 0, 1])
    if sec is None:
        continue
    planar, _ = sec.to_2D(to_2D=np.eye(4))
    region = unary_union([p.buffer(0) for p in planar.polygons_full]).simplify(0.01, preserve_topology=True)
    polys = list(region.geoms) if isinstance(region, MultiPolygon) else [region]
    rings = []
    for p in polys:
        if p.is_empty:
            continue
        rings.append([[round(x / 10, 5), round(y / 10, 5)] for x, y in list(p.exterior.coords)[:-1]])
        rings += [[[round(x / 10, 5), round(y / 10, 5)] for x, y in list(h.coords)[:-1]] for h in p.interiors]
    layers.append({"z0": round(z0 / 10, 5), "h": round((z1 - z0) / 10, 5), "polys": [
        {"outer": [[round(x / 10, 5), round(y / 10, 5)] for x, y in list(p.exterior.coords)[:-1]],
         "holes": [[[round(x / 10, 5), round(y / 10, 5)] for x, y in list(h.coords)[:-1]] for h in p.interiors]}
        for p in polys if not p.is_empty]})

script = '''def make(design, root, P):
    # Parametric, so the saved .f3d keeps its sketches and extrusions (the add-in starts in direct mode).
    design.designType = adsk.fusion.DesignTypes.ParametricDesignType
    LAYERS = %s

    def inside(pt, ring):
        x, y = pt
        c = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                c = not c
            j = i
        return c

    def solid_at(pt, polys):
        return any(inside(pt, p["outer"]) and not any(inside(pt, h) for h in p["holes"]) for p in polys)

    # A point inside a profile: its centroid when that is inside, else a point just beside one of its longest
    # edges. A thin ring (a cookie-cutter wall) has its centroid in the empty middle, which looked like no solid.
    def point_in(prof):
        segs = []
        for lp in prof.profileLoops:
            for pc in lp.profileCurves:
                g = pc.geometry
                segs.append(((g.startPoint.x, g.startPoint.y), (g.endPoint.x, g.endPoint.y)))
        def in_prof(x, y):
            c = False
            for (xi, yi), (xj, yj) in segs:
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                    c = not c
            return c
        cen = prof.areaProperties(adsk.fusion.CalculationAccuracy.MediumCalculationAccuracy).centroid
        if in_prof(cen.x, cen.y):
            return (cen.x, cen.y)
        for (xi, yi), (xj, yj) in sorted(segs, key=lambda s: -((s[1][0] - s[0][0]) ** 2 + (s[1][1] - s[0][1]) ** 2))[:20]:
            mx, my, dx, dy = (xi + xj) / 2, (yi + yj) / 2, xj - xi, yj - yi
            ln = (dx * dx + dy * dy) ** 0.5 or 1
            for d in (0.001, 0.0002):
                for sgn in (1, -1):
                    x, y = mx - sgn * d * dy / ln, my + sgn * d * dx / ln
                    if in_prof(x, y):
                        return (x, y)
        return (cen.x, cen.y)

    for n, L in enumerate(LAYERS):
        sk = root.sketches.add(plane_at(root, L["z0"]))
        sk.name = "Layer %%d" %% (n + 1)
        sk.isComputeDeferred = True
        lines = sk.sketchCurves.sketchLines
        for p in L["polys"]:
            for ring in [p["outer"]] + p["holes"]:
                pts = [P3(x, y, 0) for x, y in ring]
                for i in range(len(pts)):
                    lines.addByTwoPoints(pts[i], pts[(i + 1) %% len(pts)])
        sk.isComputeDeferred = False
        keep = []
        for prof in sk.profiles:
            if solid_at(point_in(prof), L["polys"]):
                keep.append(prof)
        if not keep:
            raise RuntimeError("Layer %%d came out empty." %% (n + 1))
        root.features.extrudeFeatures.addSimple(coll(keep), VI(L["h"]), NEW if n == 0 else JOIN)
''' % json.dumps(layers, separators=(",", ":"))
json.dump({"name": name, "recipe": "script", "script": script, "params": {}, "formats": ["3mf", "stl", "step", "f3d"]}, open(out, "w"))
print(f"{name}: {len(layers)} layers, {sum(len(p['outer']) + sum(len(h) for h in p['holes']) for L in layers for p in L['polys'])} points, size {np.round(m.extents, 2).tolist()} mm, script {len(script)//1024} KB")
