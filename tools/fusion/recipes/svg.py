# Shape from an SVG drawing: every closed shape becomes solid (holes inside shapes stay open), scaled to the width.
def make(design, root, P):
    sk = root.sketches.add(root.xYConstructionPlane)
    if not sk.importSVG(P["_svg"], 0, 0, 1):
        raise RuntimeError("Fusion couldn't read that SVG.")
    profiles = list(sk.profiles)
    if not profiles:
        raise RuntimeError("The SVG has no closed shapes to make solid.")

    def inside(a, b):  # a's box sits inside b's box
        A, B = a.boundingBox, b.boundingBox
        return (A.minPoint.x >= B.minPoint.x - 1e-6 and A.minPoint.y >= B.minPoint.y - 1e-6 and
                A.maxPoint.x <= B.maxPoint.x + 1e-6 and A.maxPoint.y <= B.maxPoint.y + 1e-6 and
                (A.maxPoint.x - A.minPoint.x) * (A.maxPoint.y - A.minPoint.y) <
                (B.maxPoint.x - B.minPoint.x) * (B.maxPoint.y - B.minPoint.y) - 1e-9)

    # Even depth = a shape, odd depth = a hole in a shape (the inside of an O or a ring).
    keep = [p for p in profiles if sum(1 for q in profiles if q is not p and inside(p, q)) % 2 == 0]
    root.features.extrudeFeatures.addSimple(coll(keep), VI(mm(P["thickness"])), NEW)
    box = extent(all_bodies(root))
    span = box.maxPoint.x - box.minPoint.x
    if span <= 0:
        raise RuntimeError("The SVG shape has no width.")
    f = mm(P["width"]) / span
    scale_all(root, f, f, 1.0)
