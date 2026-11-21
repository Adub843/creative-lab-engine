#!/usr/bin/env python3
"""Rebuilds tools/maker/bambu-presets.js and the printer table in tools/maker/bambu.js from Bambu Studio's own profiles.

Run after a Bambu Studio update:
  1. On the PC, zip  C:\\Program Files\\Bambu Studio\\resources\\profiles\\BBL  and unzip it somewhere here.
  2. python3 scripts/maker-presets.py <that BBL folder>
It follows each preset's "inherits" and "include" the way Bambu Studio does, so the values written into a maker's
.3mf are the same ones Bambu Studio would use for "Bambu PLA Basic" on that printer and nozzle."""
import json, glob, os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "BBL"
HERE = os.path.dirname(os.path.abspath(__file__))
META = {"type", "name", "inherits", "from", "setting_id", "instantiation", "include", "compatible_printers", "filament_id", "description", "url", "nozzle_hrc_map"}
PRINTERS = {"A1": "Bambu Lab A1", "A1 mini": "Bambu Lab A1 mini", "P1S": "Bambu Lab P1S", "P1P": "Bambu Lab P1P", "P2S": "Bambu Lab P2S", "X1C": "Bambu Lab X1 Carbon", "X1": "Bambu Lab X1", "X1E": "Bambu Lab X1E",
            "X2D": "Bambu Lab X2D", "H2D": "Bambu Lab H2D", "H2D Pro": "Bambu Lab H2D Pro", "H2C": "Bambu Lab H2C", "H2S": "Bambu Lab H2S", "A2L": "Bambu Lab A2L"}
BASE = "Bambu PLA Basic @BBL P1S 0.4 nozzle"

def load(kind):
    d = {}
    for f in glob.glob(os.path.join(ROOT, kind, "**", "*.json"), recursive=True):
        try:
            j = json.load(open(f, encoding="utf-8-sig")); d[j["name"]] = j
        except Exception:
            pass
    return d

ALL = {k: load(k) for k in ("filament", "machine")}

def resolve(kind, name):
    j = ALL[kind][name]; out = {}
    if j.get("inherits"): out.update(resolve(kind, j["inherits"]))
    for inc in j.get("include") or []: out.update({k: v for k, v in ALL[kind][inc].items() if k not in META})
    out.update({k: v for k, v in j.items() if k not in META})
    return out

table = {}
for key, model in PRINTERS.items():
    noz = {}
    for name in ALL["machine"]:
        m = resolve("machine", name)
        if ALL["machine"][name].get("instantiation") == "true" and m.get("printer_model") == model and name == "%s %s nozzle" % (model, m.get("printer_variant")):
            a = m["printable_area"][2].strip().split("x"); noz[m["printer_variant"]] = [m["default_print_profile"], m["default_filament_profile"][0]]
            table[key] = [model, [int(a[0]), int(a[1])], int(m["printable_height"]), noz, len(m["nozzle_diameter"])]
names = sorted({v[1] for p in table.values() for v in p[3].values()})
res = {n: {k: v for k, v in resolve("filament", n).items() if isinstance(v, list) and k != "filament_settings_id"} for n in names}
base = res[BASE]; diff = {}
for n, r in res.items():
    if n == BASE: continue
    d = {k: v for k, v in r.items() if base.get(k) != v}
    d.update({k: None for k in base if k not in r}); diff[n] = d
pack = {"filament": {"base": base, "name": BASE, "diff": diff}}
head = ("/* Bambu PLA Basic exactly as Bambu Studio ships it for every printer and nozzle (built by scripts/maker-presets.py from its own profiles).\n"
        "   base = the P1S 0.4 preset; diff = what each other preset changes (null = not in that preset). Loaded only when a file is exported. */\n")
open(os.path.join(HERE, "../tools/maker/bambu-presets.js"), "w").write(head + "(function(r){var P=" + json.dumps(pack, separators=(",", ":")) + ";if(typeof module===\"object\"&&module.exports)module.exports=P;else r.MakerBambuPresets=P;})(typeof self!==\"undefined\"?self:this);\n")
p = os.path.join(HERE, "../tools/maker/bambu.js"); s = open(p).read()
s = re.sub(r"const PRINTERS = .*?;\n", lambda _m: "const PRINTERS = " + json.dumps(table, separators=(",", ":")) + ";\n", s, count=1)
open(p, "w").write(s)
print(len(table), "printers,", len(names), "filament presets")
