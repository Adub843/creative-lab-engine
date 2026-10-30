#!/usr/bin/env python3
"""Build the Charleston 3D filament tracker from hq/data/filament.

Inputs (all in hq/data/filament):
  polymaker-official.csv  Polymaker's own hex codes and TD values (wiki.polymaker.com "HEX codes and TD").
  community/*.json        SpoolmanDB (MIT): every other brand's colors and hex values.
  prices.csv              One row per brand, type and store, with the date it was checked.

Outputs:
  hq/public/data/filament.json          what the console's Filament page reads
  hq/public/data/filament-tracker.xlsx  the Excel sheet (also the download on that page)

Run from the repo root:  python3 hq/scripts/build-filament.py
"""
import csv, glob, json, os, re, datetime
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data", "filament")
OUT = os.path.join(ROOT, "public", "data")

# Polymaker comes first, then the brands people buy most in the US, then everything else A to Z.
BRAND_ORDER = ["Polymaker", "Bambu Lab", "ELEGOO", "eSun", "Sunlu", "Prusament", "Hatchbox", "Overture",
               "Inland", "Creality", "ANYCUBIC", "JAYO", "Kingroon", "Protopasta"]
PRICE_BRAND = {"eSUN": "eSun", "SUNLU": "Sunlu", "HATCHBOX": "Hatchbox", "OVERTURE": "Overture"}
FINISHES = ["Dual Silk", "Gradient Silk", "Silk", "Dual Matte", "Gradient Matte", "Matte", "Satin", "Marble",
            "Translucent", "Transparent", "Neon", "Metallic", "Metal", "Celestial", "Starlight", "Galaxy", "Sparkle",
            "Glitter", "Glow", "Luminous", "UV Shift", "Wood", "Rainbow", "Gradient", "Dual", "Tri"]


def finish_of(text):
    for f in FINISHES:
        if re.search(r"\b" + re.escape(f) + r"\b", text, re.I):
            return f
    return "Basic"


def type_of(material, line):
    m = material.upper().replace("TPU-95A", "TPU")
    if m == "PLA" and re.search(r"PLA\+|PLA Plus|PLA Pro|Tough", line, re.I):
        return "PLA+"
    return m


def clean_hex(h):
    h = (h or "").strip().lstrip("#").upper()
    return "#" + h if re.fullmatch(r"[0-9A-F]{6}", h) else ""


def load_polymaker():
    rows = []
    with open(os.path.join(DATA, "polymaker-official.csv"), newline="") as f:
        for r in csv.DictReader(f):
            line, hexes = r["Product"], [clean_hex(x) for x in r["HEX"].split(",")]
            mat = "PETG" if re.search(r"PETG|CoPE", line) else "ASA" if "ASA" in line else "PA" if re.search(r"PA6|PA12|PA612", line) \
                else "PET" if "PET-" in line else "PPS" if "PPS" in line else "PC" if " PC" in line else "PLA"
            rows.append({"brand": "Polymaker", "line": line, "type": type_of(mat, line), "finish": finish_of(line + " " + r["Color"]),
                         "color": r["Color"], "hex": hexes[0], "hex2": hexes[1] if len(hexes) > 1 else "",
                         "td": r["TD"], "sku": r["SKU"], "source": "Polymaker official"})
    return rows


def load_community():
    rows = []
    for path in sorted(glob.glob(os.path.join(DATA, "community", "*.json"))):
        d = json.load(open(path))
        brand = d["manufacturer"]
        for fl in d["filaments"]:
            line = fl["name"].replace("{color_name}", "").strip()
            if brand == "Polymaker" and fl["material"] in ("PLA", "PETG") and not re.search(r"LW-PLA|PolyWood|CosPLA", line):
                continue  # Polymaker's own list covers these with their current names
            for c in fl.get("colors", []):
                hexes = [clean_hex(c.get("hex"))] if c.get("hex") else [clean_hex(x) for x in c.get("hexes", [])]
                hexes = [h for h in hexes if h] or [""]
                rows.append({"brand": brand, "line": line or fl["material"], "type": type_of(fl["material"], line),
                             "finish": c.get("finish") and c["finish"].title() or finish_of(line + " " + c["name"]),
                             "color": c["name"], "hex": hexes[0], "hex2": hexes[1] if len(hexes) > 1 else "",
                             "td": "", "sku": "", "source": "SpoolmanDB"})
    return rows


def brand_rank(b):
    low = [x.lower() for x in BRAND_ORDER]
    return (low.index(b.lower()), "") if b.lower() in low else (len(low), b.lower())


def load_prices():
    offers = defaultdict(list)
    with open(os.path.join(DATA, "prices.csv"), newline="") as f:
        for r in csv.DictReader(f):
            b = PRICE_BRAND.get(r["brand"], r["brand"])
            offers[(b, r["type"])].append({"store": r["store"], "price": float(r["price_usd"]), "note": r["note"],
                                           "url": r["url"], "checked": r["checked"]})
    out = []
    for (b, t), offs in offers.items():
        offs.sort(key=lambda o: o["price"])
        out.append({"brand": b, "type": t, "top": offs[:3], "all": len(offs)})
    out.sort(key=lambda p: (brand_rank(p["brand"]), ["PLA", "Matte PLA", "Silk PLA", "PLA+", "PETG", "ABS", "ASA", "TPU 95A"].index(p["type"]) if p["type"] in ["PLA", "Matte PLA", "Silk PLA", "PLA+", "PETG", "ABS", "ASA", "TPU 95A"] else 99))
    return out


def text_on(hexv):
    if not hexv:
        return "000000"
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    return "000000" if (r * 299 + g * 587 + b * 114) / 1000 > 140 else "FFFFFF"


def sheet(ws, headers, widths):
    ws.append(headers)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="0F766E")
    ws.freeze_panes = "A2"


def swatch(cell, hexv):
    if hexv:
        cell.fill = PatternFill("solid", fgColor=hexv[1:])
        cell.font = Font(color=text_on(hexv))


def main():
    today = datetime.date.today().isoformat()
    colors = load_polymaker() + load_community()
    colors.sort(key=lambda r: (brand_rank(r["brand"]), r["source"] != "Polymaker official", r["type"], r["line"], r["color"]))
    prices = load_prices()
    brands = sorted({r["brand"] for r in colors}, key=brand_rank)

    # Mockup palette: for each plain color name, the Polymaker PLA hex first, otherwise the first other brand that has it.
    names = ["White", "Cold White", "Cream", "Beige", "Tan", "Grey", "Dark Grey", "Black", "Red", "Wine Red", "Orange",
             "Yellow", "Lemon Yellow", "Lime Green", "Green", "Jungle Green", "Olive Green", "Teal", "Aqua Blue",
             "Light Blue", "Azure Blue", "Blue", "Navy Blue", "Purple", "Lavender", "Magenta", "Pink", "Brown", "Gold",
             "Silver", "Bronze", "Copper", "Clear"]
    palette = []
    ALIAS = {"Lavender": "Lavender( Purple)?", "Clear": "(Clear|Natural)"}
    lines_first = ["Panchroma PLA", "Panchroma Matte PLA", "Panchroma Silk PLA", "Panchroma Satin PLA", "Panchroma Metallic PLA"]
    pm_first = sorted((r for r in colors if r["brand"] == "Polymaker" and r["type"] == "PLA"),
                      key=lambda r: lines_first.index(r["line"]) if r["line"] in lines_first else len(lines_first))
    for n in names:
        pick = next((r for r in pm_first if r["hex"] and
                     re.fullmatch(r"(Matte |Silk |Metallic |Satin |Translucent )?(Polymaker )?" + ALIAS.get(n, re.escape(n)), r["color"], re.I)), None)
        if not pick:
            pick = next((r for r in colors if r["brand"] != "Polymaker" and r["type"] == "PLA" and r["hex"] and
                         r["color"].lower() == n.lower()), None)
        if pick:
            palette.append({"name": n, "hex": pick["hex"], "brand": pick["brand"], "line": pick["line"], "color": pick["color"]})

    wb = Workbook()
    ws = wb.active
    ws.title = "Read me"
    pm_pla = sum(1 for r in colors if r["brand"] == "Polymaker" and r["type"] in ("PLA", "PLA+"))
    lines = [
        ["Charleston 3D filament tracker"],
        ["Updated", today],
        ["Brands", len(brands)],
        ["Colors", len(colors)],
        ["Polymaker PLA colors (official hex)", pm_pla],
        ["Brand and type prices", len(prices)],
        [],
        ["Rule for mockups and images", "Use Polymaker PLA colors first (tab 'Polymaker PLA'). Use another brand's color only when Polymaker doesn't make it."],
        ["Polymaker colors", "Polymaker's own hex codes and TD values from wiki.polymaker.com."],
        ["Other brands", "SpoolmanDB community filament database (MIT license), refreshed weekly."],
        ["Prices", "Top 3 cheapest single 1 kg spools found per brand and type across the official store, Amazon, Walmart and MatterHackers. Prices change daily; check the link before buying."],
        ["Refresh", "Every Sunday the weekly task searches again, rebuilds this file and the console page."],
        ["Add a brand or price", "Add rows to hq/data/filament/prices.csv or a file in hq/data/filament/community, then run python3 hq/scripts/build-filament.py."],
    ]
    for l in lines:
        ws.append(l)
    ws["A1"].font = Font(bold=True, size=14)
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 110
    for row in ws.iter_rows(min_row=2):
        row[0].font = Font(bold=True)
        if len(row) > 1:
            row[1].alignment = Alignment(wrap_text=True, vertical="top", horizontal="left")

    ws = wb.create_sheet("Polymaker PLA")
    sheet(ws, ["Line", "Color", "Swatch", "Hex", "Second hex", "TD", "SKU"], [32, 40, 10, 10, 11, 6, 10])
    order = lambda r: (lines_first.index(r["line"]) if r["line"] in lines_first else len(lines_first), r["line"])
    for r in sorted(colors, key=order):
        if r["brand"] == "Polymaker" and r["type"] in ("PLA", "PLA+"):
            ws.append([r["line"], r["color"], "", r["hex"], r["hex2"], r["td"], r["sku"]])
            swatch(ws.cell(ws.max_row, 3), r["hex"])
            swatch(ws.cell(ws.max_row, 5), r["hex2"])
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("Mockup palette")
    sheet(ws, ["Color", "Swatch", "Hex", "Brand", "Line", "Brand's color name"], [16, 10, 10, 14, 32, 34])
    for p in palette:
        ws.append([p["name"], "", p["hex"], p["brand"], p["line"], p["color"]])
        swatch(ws.cell(ws.max_row, 2), p["hex"])

    ws = wb.create_sheet("Prices")
    sheet(ws, ["Brand", "Type", "1st store", "1st price", "2nd store", "2nd price", "3rd store", "3rd price", "Checked", "1st link", "2nd link", "3rd link"],
          [14, 11, 15, 10, 15, 10, 15, 10, 11, 40, 40, 40])
    for p in prices:
        t = p["top"] + [None] * (3 - len(p["top"]))
        row = [p["brand"], p["type"]]
        for o in t:
            row += [o["store"], o["price"]] if o else ["", ""]
        row += [max(o["checked"] for o in p["top"])] + [o["url"] if o else "" for o in t]
        ws.append(row)
        for i, o in enumerate(t):
            if o:
                ws.cell(ws.max_row, 4 + 2 * i).number_format = '"$"0.00'
                ws.cell(ws.max_row, 10 + i).hyperlink = o["url"]
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("All colors")
    sheet(ws, ["Brand", "Type", "Finish", "Line", "Color", "Swatch", "Hex", "Second hex", "Source"], [14, 8, 12, 40, 34, 10, 10, 11, 18])
    for r in colors:
        ws.append([r["brand"], r["type"], r["finish"], r["line"], r["color"], "", r["hex"], r["hex2"], r["source"]])
        swatch(ws.cell(ws.max_row, 6), r["hex"])
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("Brands")
    sheet(ws, ["Brand", "Colors", "Lines", "Types"], [18, 8, 8, 60])
    for b in brands:
        rs = [r for r in colors if r["brand"] == b]
        ws.append([b, len(rs), len({r["line"] for r in rs}), ", ".join(sorted({r["type"] for r in rs}))])

    os.makedirs(OUT, exist_ok=True)
    wb.save(os.path.join(OUT, "filament-tracker.xlsx"))
    keys = ["brand", "type", "finish", "line", "color", "hex", "hex2", "td", "source"]
    json.dump({"updated": today, "brands": brands, "palette": palette, "prices": prices,
               "keys": keys, "colors": [[r[k] for k in keys] for r in colors]},
              open(os.path.join(OUT, "filament.json"), "w"), separators=(",", ":"))
    print(f"{len(brands)} brands, {len(colors)} colors, {pm_pla} Polymaker PLA, {len(prices)} price rows, {len(palette)} palette colors")


if __name__ == "__main__":
    main()
