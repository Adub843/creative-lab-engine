# Sign, name plate or key tag: a rounded plate with raised text, plus a key ring hole or two screw holes.
def make(design, root, P):
    w, h, t = mm(P["width"]), mm(P["height"]), mm(P["thickness"])
    block(root, w, h, t, mm(P["corner"]))
    left, right = -w / 2.0 + mm(2), w / 2.0 - mm(2)
    if P["holes"] == "keyring":
        dia = mm(5)
        x = -w / 2.0 + mm(3) + dia / 2.0
        hole(root, x, 0, dia, 0, t)
        left = x + dia / 2.0 + mm(2)
    elif P["holes"] == "screws":
        dia = mm(4)
        for x in (-w / 2.0 + mm(3) + dia / 2.0, w / 2.0 - mm(3) - dia / 2.0):
            hole(root, x, 0, dia, 0, t)
        left, right = -w / 2.0 + mm(6) + dia, w / 2.0 - mm(6) - dia
    size = min(mm(P["textSize"]), h * 0.75)
    raised_text(root, P["text"], size, mm(P["textDepth"]), left, -h / 2.0 + mm(1.5), right, h / 2.0 - mm(1.5), t)
