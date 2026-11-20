# Resize or convert a library file: opens STEP, STL, OBJ or 3MF and scales it so its longest side is P["longest"] mm.
def make(design, root, P):
    src = P.get("_input")
    if not src:
        raise RuntimeError("No input file came with this job.")
    ext = src.rsplit(".", 1)[-1].lower()
    if ext in ("step", "stp"):
        im = app.importManager
        im.importToTarget(im.createSTEPImportOptions(src), root)
    elif ext in ("stl", "obj", "3mf"):
        root.meshBodies.add(src, adsk.fusion.MeshUnits.MillimeterMeshUnit)
    else:
        raise RuntimeError("Fusion jobs can open STEP, STL, OBJ or 3MF files.")
    if float(P.get("longest") or 0) > 0:
        box = extent(all_bodies(root))
        longest = max(box.maxPoint.x - box.minPoint.x, box.maxPoint.y - box.minPoint.y, box.maxPoint.z - box.minPoint.z)
        if longest <= 0:
            raise RuntimeError("The file has no size.")
        scale_all(root, mm(P["longest"]) / longest)
