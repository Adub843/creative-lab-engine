# Storage box with rounded corners and an optional slip-on lid (printed beside it as a shallow tray: flip it on).
def make(design, root, P):
    w, d, h = mm(P["width"]), mm(P["depth"]), mm(P["height"])
    t, r = mm(P["wall"]), mm(P["corner"])
    box = block(root, w, d, h, r)
    shell_open(root, box, face_at_z(box, h), t)
    if P.get("lid"):
        gap = mm(0.3)  # room so the lid slides on after printing
        lw, ld = w + 2 * (t + gap), d + 2 * (t + gap)
        lh = t + mm(8)
        cx = w / 2.0 + mm(10) + lw / 2.0
        lid = block(root, lw, ld, lh, r + t + gap if r > 0 else 0, cx=cx)
        shell_open(root, lid, face_at_z(lid, lh), t)
