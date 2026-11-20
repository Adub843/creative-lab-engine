# Shape from an SVG drawing: every closed shape becomes solid (holes inside shapes stay open), scaled to the width.
def make(design, root, P):
    sk = root.sketches.add(root.xYConstructionPlane)
    if not sk.importSVG(P["_svg"], 0, 0, 1):
        raise RuntimeError("Fusion couldn't read that SVG.")
    profiles = list(sk.profiles)
    if not profiles:
        raise RuntimeError("The SVG has no closed shapes to make solid.")

    def loop_box(loop):
        box = None
        for c in loop.profileCurves:
            if box is None:
                box = c.boundingBox.copy()
            else:
                box.combine(c.boundingBox)
        return box

    def inside(A, B):  # A's box sits inside B's box (2% slack: Fusion's SVG arcs aren't exact)
        tol = 0.02 * max(B.maxPoint.x - B.minPoint.x, B.maxPoint.y - B.minPoint.y) + 1e-6
        return (A.minPoint.x >= B.minPoint.x - tol and A.minPoint.y >= B.minPoint.y - tol and
                A.maxPoint.x <= B.maxPoint.x + tol and A.maxPoint.y <= B.maxPoint.y + tol)

    # Fusion splits overlapping shapes into separate profiles, so a piece is a hole only when it sits inside
    # another profile's INNER loop (the inside of an O or a ring), counted even/odd for islands in holes.
    inner = [(p, loop_box(l)) for p in profiles for l in p.profileLoops if not l.isOuter]
    keep = [p for p in profiles if sum(1 for q, box in inner if q is not p and box is not None and inside(p.boundingBox, box)) % 2 == 0]
    if not keep:
        raise RuntimeError("The SVG has no solid shapes, only holes.")
    root.features.extrudeFeatures.addSimple(coll(keep), VI(mm(P["thickness"])), NEW)
    box = extent(all_bodies(root))
    span = box.maxPoint.x - box.minPoint.x
    if span <= 0:
        raise RuntimeError("The SVG shape has no width.")
    f = mm(P["width"]) / span
    scale_all(root, f, f, 1.0)
