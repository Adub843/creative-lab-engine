# Helpers every Fusion job gets (recipes and scripts). Sizes passed to these are CENTIMETRES (Fusion's own unit):
# wrap millimetres with mm(). Kept small and plain so a person, Claude or Alice can read and extend them.

def mm(v):
    return float(v) / 10.0


def P3(x, y, z=0.0):
    return adsk.core.Point3D.create(x, y, z)


def VI(v):
    return adsk.core.ValueInput.createByReal(float(v))


def coll(items):
    c = adsk.core.ObjectCollection.create()
    for i in items:
        c.add(i)
    return c


NEW = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
JOIN = adsk.fusion.FeatureOperations.JoinFeatureOperation
CUT = adsk.fusion.FeatureOperations.CutFeatureOperation


def plane_at(root, z):
    """A sketch plane parallel to XY at height z (cm)."""
    if abs(z) < 1e-9:
        return root.xYConstructionPlane
    pi = root.constructionPlanes.createInput()
    pi.setByOffset(root.xYConstructionPlane, VI(z))
    return root.constructionPlanes.add(pi)


def vertical_edges(body):
    out = []
    for e in body.edges:
        a, b = e.startVertex.geometry, e.endVertex.geometry
        if abs(a.x - b.x) < 1e-6 and abs(a.y - b.y) < 1e-6 and abs(a.z - b.z) > 1e-6:
            out.append(e)
    return out


def fillet(root, edges, r):
    if r <= 0 or not edges:
        return
    fi = root.features.filletFeatures.createInput()
    try:
        fi.edgeSetInputs.addConstantRadiusEdgeSet(coll(edges), VI(r), True)
    except AttributeError:
        fi.addConstantRadiusEdgeSet(coll(edges), VI(r), True)
    root.features.filletFeatures.add(fi)


def block(root, w, d, h, r=0.0, cx=0.0, cy=0.0, z=0.0, op=None):
    """A box w x d x h (cm) centred on (cx, cy), from height z up, with its upright corners rounded by r."""
    sk = root.sketches.add(plane_at(root, z))
    sk.sketchCurves.sketchLines.addCenterPointRectangle(P3(cx, cy, 0), P3(cx + w / 2.0, cy + d / 2.0, 0))
    ext = root.features.extrudeFeatures.addSimple(sk.profiles.item(0), VI(h), op or NEW)
    body = ext.bodies.item(0)
    r = min(r, w / 2.0 - 0.01, d / 2.0 - 0.01)
    if r > 0 and (op or NEW) == NEW:
        fillet(root, vertical_edges(body), r)
    return body


def face_at_z(body, z, tol=1e-5):
    """The flat face of body lying at height z (cm), facing up or down."""
    for f in body.faces:
        if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType and abs(f.pointOnFace.z - z) < tol:
            n = f.geometry.normal
            if abs(abs(n.z) - 1) < 1e-6:
                return f
    raise RuntimeError("No flat face at that height.")


def shell_open(root, body, open_face, wall):
    si = root.features.shellFeatures.createInput(coll([open_face]), False)
    si.insideThickness = VI(wall)
    return root.features.shellFeatures.add(si)


def hole(root, x, y, dia, z0, depth):
    """Cuts a round hole of diameter dia at (x, y), from height z0 up through depth (cm)."""
    sk = root.sketches.add(plane_at(root, z0))
    sk.sketchCurves.sketchCircles.addByCenterRadius(P3(x, y, 0), dia / 2.0)
    root.features.extrudeFeatures.addSimple(sk.profiles.item(0), VI(depth), CUT)


def raised_text(root, text, size, depth, x0, y0, x1, y1, z, font="Arial", bold=True):
    """Raised text centred in the box (x0,y0)-(x1,y1) on the plane at height z (cm), joined to the body under it."""
    sk = root.sketches.add(plane_at(root, z))
    ti = sk.sketchTexts.createInput2(text, size)
    ti.setAsMultiLine(P3(x0, y0, 0), P3(x1, y1, 0),
                      adsk.core.HorizontalAlignments.CenterHorizontalAlignment,
                      adsk.core.VerticalAlignments.MiddleVerticalAlignment, 0)
    ti.fontName = font
    if bold:
        ti.textStyle = adsk.fusion.TextStyles.TextStyleBold
    st = sk.sketchTexts.add(ti)
    return root.features.extrudeFeatures.addSimple(st, VI(depth), JOIN)


def all_bodies(root):
    out = list(root.bRepBodies) + list(root.meshBodies)
    for occ in root.allOccurrences:
        out += list(occ.bRepBodies) + list(occ.meshBodies)
    return out


def extent(bodies):
    box = None
    for b in bodies:
        if box is None:
            box = b.boundingBox.copy()
        else:
            box.combine(b.boundingBox)
    return box


def scale_all(root, fx, fy=None, fz=None):
    """Scales every body in the design about the origin (uniform, or per axis when fy/fz are given)."""
    bodies = all_bodies(root)
    if not bodies:
        raise RuntimeError("Nothing to scale.")
    si = root.features.scaleFeatures.createInput(coll(bodies), root.originConstructionPoint, VI(fx))
    if fy is not None or fz is not None:
        si.setToNonUniform(VI(fx), VI(fy if fy is not None else fx), VI(fz if fz is not None else fx))
    return root.features.scaleFeatures.add(si)
