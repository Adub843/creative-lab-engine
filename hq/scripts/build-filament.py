#!/usr/bin/env python3
"""Build the Charleston 3D filament tracker from hq/data/filament.

Inputs (all in hq/data/filament):
  polymaker-official.csv  Polymaker's own hex codes and TD values (wiki.polymaker.com "HEX codes and TD").
  community/*.json        SpoolmanDB (MIT): every other brand's colors and hex values.
  prices.csv              One row per offer: brand, type, store, single/bulk/wholesale, pack kg, price, rating, link.
  ratings.csv             Average star rating and review count per brand and type (Amazon search, review-weighted).
  suppliers.csv           Wholesale and bulk programs (minimums, discounts, what a reseller needs to apply).

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
               "Inland", "Creality", "ANYCUBIC", "JAYO", "Kingroon", "Protopasta", "GEEETECH", "ERYONE"]
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


TYPE_ORDER = ["PLA", "Matte PLA", "Silk PLA", "PLA+", "PETG", "ABS", "ASA", "TPU 95A"]


def load_ratings():
    path = os.path.join(DATA, "ratings.csv")
    if not os.path.exists(path):
        return {}
    with open(path, newline="") as f:
        return {(PRICE_BRAND.get(r["brand"], r["brand"]), r["type"]): (round(float(r["avg_rating"]), 1), int(r["reviews"]))
                for r in csv.DictReader(f)}


RATINGS = load_ratings()


def load_prices():
    """Every offer, ranked by price per kg. Bulk packs and wholesale count, so a 10 kg box can beat a single spool."""
    offers = defaultdict(list)
    with open(os.path.join(DATA, "prices.csv"), newline="") as f:
        for r in csv.DictReader(f):
            b = PRICE_BRAND.get(r["brand"], r["brand"])
            kg = float(r["pack_kg"] or 1)
            price = float(r["price_usd"])
            offers[(b, r["type"])].append({"store": r["store"], "kind": r["kind"], "kg": kg, "price": price,
                                           "per_kg": round(price / kg, 2), "rating": float(r["rating"]) if r["rating"] else None,
                                           "reviews": int(float(r["reviews"])) if r["reviews"] else 0, "product": r["product"],
                                           "url": r["url"], "checked": r["checked"]})
    out = []
    for (b, t), offs in offers.items():
        offs.sort(key=lambda o: o["per_kg"])
        # one row per store in the top 3, so the list shows 3 different places to buy
        top, seen = [], set()
        for o in offs:
            if o["store"] not in seen:
                top.append(o)
                seen.add(o["store"])
        rated = [o for o in offs if o["rating"] and o["reviews"]]
        n = sum(o["reviews"] for o in rated)
        avg = round(sum(o["rating"] * o["reviews"] for o in rated) / n, 1) if n else None
        if (b, t) in RATINGS:
            avg, n = RATINGS[(b, t)]
        single = min((o for o in offs if o["kg"] <= 1.1), key=lambda o: o["per_kg"], default=None)
        out.append({"brand": b, "type": t, "top": top[:3], "all": len(offs), "rating": avg, "reviews": n,
                    "single": single, "offers": offs})
    out.sort(key=lambda p: (brand_rank(p["brand"]), TYPE_ORDER.index(p["type"]) if p["type"] in TYPE_ORDER else 99))
    return out


def load_suppliers():
    with open(os.path.join(DATA, "suppliers.csv"), newline="") as f:
        return list(csv.DictReader(f))


TOLERANCE = {"Prusament": "±0.02 mm (guaranteed)", "Polymaker": "±0.03 mm", "Bambu Lab": "±0.03 mm", "ELEGOO": "±0.02 mm",
             "Hatchbox": "±0.03 mm", "Overture": "±0.03 mm", "eSun": "±0.03 mm", "Sunlu": "±0.02 mm", "Creality": "±0.03 mm",
             "JAYO": "±0.02 mm", "Kingroon": "±0.03 mm", "ANYCUBIC": "±0.02 mm"}


def load_specs():
    """Print settings and spool facts for every product line, from SpoolmanDB."""
    rows = []
    for path in sorted(glob.glob(os.path.join(DATA, "community", "*.json"))):
        d = json.load(open(path))
        brand = d["manufacturer"]
        for fl in d["filaments"]:
            line = fl["name"].replace("{color_name}", "").strip() or fl["material"]
            rng = lambda k: "–".join(str(int(x)) for x in fl.get(k, [])) + " °C" if fl.get(k) else ""
            ws = fl.get("weights", [])
            rows.append({"brand": brand, "line": line, "type": type_of(fl["material"], line),
                         "nozzle": rng("extruder_temp_range") or (str(fl["extruder_temp"]) + " °C" if fl.get("extruder_temp") else ""),
                         "bed": rng("bed_temp_range") or (str(fl["bed_temp"]) + " °C" if fl.get("bed_temp") else ""),
                         "density": fl.get("density", ""), "diameter": ", ".join(str(x) for x in fl.get("diameters", [])) + " mm",
                         "spools": ", ".join(sorted({(str(int(w["weight"])) + " g") for w in ws}, key=lambda x: int(x.split()[0]))),
                         "spool_type": ", ".join(sorted({w.get("spool_type", "") for w in ws if w.get("spool_type")})),
                         "colors": len(fl.get("colors", [])), "tolerance": TOLERANCE.get(brand, "")})
    rows.sort(key=lambda r: (brand_rank(r["brand"]), r["type"], r["line"]))
    return rows


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
    suppliers = load_suppliers()
    specs = load_specs()
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
        ["Offers checked", sum(p["all"] for p in prices)],
        ["Wholesale and bulk programs", len(suppliers)],
        [],
        ["Rule for mockups and images", "Use Polymaker PLA colors first (tab 'Polymaker PLA'). Use another brand's color only when Polymaker doesn't make it."],
        ["Polymaker colors", "Polymaker's own hex codes and TD values from wiki.polymaker.com."],
        ["Other brands", "SpoolmanDB community filament database (MIT license), refreshed weekly."],
        ["Prices", "Ranked by price per kg, so bulk boxes and wholesale count. Top 3 different stores per brand and type, plus the cheapest single 1 kg spool and the average star rating. Sources: brand stores and their bulk boxes, Polymaker US Wholesale, Amazon, Walmart, MatterHackers. Prices change daily; check the link before buying."],
        ["Wholesale", "Tab 'Wholesale & bulk': programs you can join with your reseller certificate, with minimum order, discount and how to apply."],
        ["Ratings", "Average stars weighted by review count across that brand and type's Amazon listings."],
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

    money = '"$"0.00'
    ws = wb.create_sheet("Prices")
    sheet(ws, ["Brand", "Type", "Avg stars", "Reviews", "Best store", "$/kg", "Pack", "Price",
               "2nd store", "$/kg", "Pack", "Price", "3rd store", "$/kg", "Pack", "Price",
               "Cheapest 1 kg spool", "Store", "Checked", "Best link", "2nd link", "3rd link", "1 kg link"],
          [12, 10, 9, 9, 20, 8, 7, 9, 20, 8, 7, 9, 20, 8, 7, 9, 10, 20, 11, 30, 30, 30, 30])
    for p in prices:
        t = p["top"] + [None] * (3 - len(p["top"]))
        row = [p["brand"], p["type"], p["rating"] or "", p["reviews"] or ""]
        for o in t:
            row += [o["store"], o["per_kg"], f'{o["kg"]:g} kg', o["price"]] if o else ["", "", "", ""]
        sg = p["single"]
        row += [sg["price"] if sg else "", sg["store"] if sg else "", max(o["checked"] for o in p["top"])]
        row += [o["url"] if o else "" for o in t] + [sg["url"] if sg else ""]
        ws.append(row)
        r = ws.max_row
        for i, o in enumerate(t):
            if o:
                ws.cell(r, 6 + 4 * i).number_format = money
                ws.cell(r, 8 + 4 * i).number_format = money
                ws.cell(r, 20 + i).hyperlink = o["url"]
        if sg:
            ws.cell(r, 17).number_format = money
            ws.cell(r, 23).hyperlink = sg["url"]
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("All offers")
    sheet(ws, ["Brand", "Type", "Store", "Kind", "Pack", "Price", "$/kg", "Stars", "Reviews", "Product", "Checked", "Link"],
          [12, 10, 22, 10, 7, 9, 8, 7, 9, 34, 11, 44])
    for p in prices:
        for o in p["offers"]:
            ws.append([p["brand"], p["type"], o["store"], o["kind"], f'{o["kg"]:g} kg', o["price"], o["per_kg"],
                       o["rating"] or "", o["reviews"] or "", o["product"], o["checked"], o["url"]])
            ws.cell(ws.max_row, 6).number_format = money
            ws.cell(ws.max_row, 7).number_format = money
            ws.cell(ws.max_row, 12).hyperlink = o["url"]
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("Wholesale & bulk")
    cols = ["company", "kind", "brands", "best_price_per_kg", "minimum_order", "discount", "what_you_need", "how_to_apply", "url", "checked"]
    sheet(ws, ["Company", "Kind", "Brands", "Best price", "Minimum order", "Discount", "What you need", "How to apply", "Link", "Checked"],
          [24, 22, 14, 44, 18, 40, 34, 40, 44, 11])
    for sp in suppliers:
        ws.append([sp[c] for c in cols])
        ws.cell(ws.max_row, 9).hyperlink = sp["url"]
        for c in ws[ws.max_row]:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.auto_filter.ref = ws.dimensions

    ws = wb.create_sheet("Product specs")
    sheet(ws, ["Brand", "Line", "Type", "Nozzle", "Bed", "Density g/cm³", "Diameter", "Spool sizes", "Spool", "Colors", "Tolerance (advertised)"],
          [14, 36, 10, 12, 11, 12, 12, 22, 16, 8, 20])
    for r in specs:
        ws.append([r["brand"], r["line"], r["type"], r["nozzle"], r["bed"], r["density"], r["diameter"], r["spools"],
                   r["spool_type"], r["colors"], r["tolerance"]])
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
    slim = [{k: v for k, v in p.items() if k != "offers"} for p in prices]
    json.dump({"updated": today, "brands": brands, "palette": palette, "prices": slim, "suppliers": suppliers,
               "keys": keys, "colors": [[r[k] for k in keys] for r in colors]},
              open(os.path.join(OUT, "filament.json"), "w"), separators=(",", ":"))
    print(f"{len(brands)} brands, {len(colors)} colors, {pm_pla} Polymaker PLA, {len(prices)} price rows, {len(palette)} palette colors")


if __name__ == "__main__":
    main()
