#!/usr/bin/env python3
"""Build the one-file copy of the maker for the Lab.

The Lab page is at its file limit, so tools/maker is published there as a single
engine/tools/maker/index.html with geo.js, bambu.js, bambu-presets.js and earcut inside it.
Usage: python3 scripts/maker-lab-build.py <out.html>
"""
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "tools"
html = (root / "maker/index.html").read_text()
parts = [("../vendor/earcut.min.js", root / "vendor/earcut.min.js"), ("geo.js", root / "maker/geo.js"), ("bambu.js", root / "maker/bambu.js")]
for src, path in parts:
    tag = f'<script src="{src}"></script>'
    code = path.read_text()
    assert html.count(tag) == 1, src
    assert "</script" not in code.lower(), src
    html = html.replace(tag, "<script>" + code + "\n</script>")
presets = (root / "maker/bambu-presets.js").read_text()
assert "</script" not in presets.lower()
first = '<script src="../vendor/earcut.min.js"></script>'
html = html.replace("<div id=\"lbMount\"></div>", "<div id=\"lbMount\"></div>\n<script>" + presets + "\n</script>", 1)
assert "MakerBambuPresets" in html
pathlib.Path(sys.argv[1]).write_text(html)
print(len(html), "bytes")
