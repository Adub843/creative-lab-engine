#!/usr/bin/env python3
"""Build the Charleston 3D supplies sheet (filament, light box parts, packing and shipping, Bambu Lab printers).

Inputs (all in hq/data/filament):
  polymaker-official.csv  Polymaker's own hex codes and TD values (wiki.polymaker.com "HEX codes and TD").
  community/*.json        SpoolmanDB (MIT): every other brand's colors and hex values.
  prices.csv              One row per offer: brand, type, store, single/bulk/wholesale, pack kg, price, rating, link.
  ratings.csv             Average star rating and review count per brand and type (Amazon search, review-weighted).
  suppliers.csv           Wholesale and bulk programs (minimums, discounts, what a reseller needs to apply).

  ../supplies/c3d-supplies.csv  Every other supply: one row per offer, with pack size so the build can rank by unit price.
  ../supplies/history.csv       Best price per item per week, appended by every build. Feeds the price graphs.

Outputs:
  hq/public/data/filament.json          what the console's Filament page reads
  hq/public/data/c3d-supplies-sheet.xlsx  the Excel sheet (also the download on that page)

Run from the repo root:  python3 hq/scripts/build-filament.py
"""
import csv, glob, json, os, re, datetime
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.chart import LineChart, Reference

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data", "filament")
OUT = os.path.join(ROOT, "public", "data")
SUP = os.path.join(ROOT, "data", "supplies")

# Aaron (2026-10-30): track 3 filament brands only, Polymaker first.
KEEP_BRANDS = ["Polymaker", "Bambu Lab", "ELEGOO"]
kept = lambda b: b.lower() in [k.lower() for k in KEEP_BRANDS]

# One color per group, used for tab colors, headers and row tints (Charleston 3D teal, brass, navy, coral).
GROUPS = {"Filament": ("0F766E", "E6F4F1"), "Light box parts": ("8A6A2F", "F6EFE0"),
          "Packing & shipping": ("1E3A5F", "E8EEF6"), "Bambu Lab printers": ("B4533F", "F9E9E5")}
# Same colors, lightened so they read on the console's dark background.
CONSOLE_COLORS = {"Filament": "#17a398", "Light box parts": "#c39a4a", "Packing & shipping": "#5b8fd6", "Bambu Lab printers": "#d0705c"}

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


def load_supplies():
    """Every non-filament supply, grouped by item, cheapest per unit first (top 3 stores/listings)."""
    items = defaultdict(list)
    with open(os.path.join(SUP, "c3d-supplies.csv"), newline="") as f:
        for r in csv.DictReader(f):
            units, price = float(r["units"]), float(r["price_usd"])
            items[(r["group"], r["item"])].append({"store": r["store"], "product": r["product"], "pack": r["pack"],
                                                   "unit": r["unit"], "price": price, "per_unit": round(price / units, 4),
                                                   "rating": float(r["rating"]) if r["rating"] else None,
                                                   "reviews": int(r["reviews"]) if r["reviews"] else 0,
                                                   "url": r["url"], "checked": r["checked"]})
    order = list(GROUPS)
    out = [{"group": g, "item": i, "top": sorted(o, key=lambda x: x["per_unit"])[:3]} for (g, i), o in items.items()]
    out.sort(key=lambda x: order.index(x["group"]) if x["group"] in order else 99)
    return out


def update_history(today, prices, supplies):
    """Add this week's best price per item to history.csv (one row per item per day) and return the whole history."""
    path = os.path.join(SUP, "history.csv")
    rows = list(csv.DictReader(open(path, newline=""))) if os.path.exists(path) else []
    rows = [r for r in rows if r["date"] != today]
    for p in prices:
        o = p["top"][0]
        rows.append({"date": today, "group": "Filament", "item": f'{p["brand"]} {p["type"]}', "best": o["per_kg"],
                     "unit": "kg", "store": o["store"]})
    for s in supplies:
        o = s["top"][0]
        rows.append({"date": today, "group": s["group"], "item": s["item"],
                     "best": o["price"] if o["unit"] == "printer" else o["per_unit"], "unit": o["unit"], "store": o["store"]})
    rows.sort(key=lambda r: (r["date"], r["group"], r["item"]))
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "group", "item", "best", "unit", "store"])
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        r["best"] = float(r["best"])
    return rows


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


def sheet(ws, headers, widths, color="0F766E"):
    ws.append(headers)
    ws.sheet_properties.tabColor = color
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=color)
    ws.freeze_panes = "A2"


def swatch(cell, hexv):
    if hexv:
        cell.fill = PatternFill("solid", fgColor=hexv[1:])
        cell.font = Font(color=text_on(hexv))


def main():
    today = datetime.date.today().isoformat()
    colors = [r for r in load_polymaker() + load_community() if kept(r["brand"])]
    colors.sort(key=lambda r: (brand_rank(r["brand"]), r["source"] != "Polymaker official", r["type"], r["line"], r["color"]))
    prices = [p for p in load_prices() if kept(p["brand"])]
    suppliers = [sp for sp in load_suppliers() if any(kept(b.strip()) for b in sp["brands"].split(","))]
    supplies = load_supplies()
    history = update_history(today, prices, supplies)
    specs = [r for r in load_specs() if kept(r["brand"])]
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
        ["Charleston 3D supplies sheet"],
        ["Updated", today],
        ["Filament brands", ", ".join(KEEP_BRANDS) + " (Polymaker first)"],
        ["Filament colors", len(colors)],
        ["Polymaker PLA colors (official hex)", pm_pla],
        ["Filament brand and type prices", len(prices)],
        ["Other supplies tracked", len(supplies)],
        ["Wholesale and bulk programs", len(suppliers)],
        [],
        ["Tabs by color", "Teal = filament, brass = light box parts, navy = packing and shipping, coral = Bambu Lab printers. 'Summary' shows the best price for everything on one page; 'Price history' has a graph per group that grows every week."],
        ["Rule for mockups and images", "Use Polymaker PLA colors first (tab 'Polymaker PLA'). Use Bambu Lab or ELEGOO colors only when Polymaker doesn't make it."],
        ["Filament prices", "Ranked by price per kg, so bulk boxes and wholesale count. Top 3 stores per brand and type, plus the cheapest single 1 kg spool and the average star rating."],
        ["Supply prices", "Ranked by unit price (per ft, box, roll, label or packet), so big packs count. Only listings rated 4.3 stars or more with 50+ reviews. Printer prices are the Bambu Lab store's base model price."],
        ["Sources", "Brand stores and their bulk boxes, Polymaker US Wholesale, Amazon, Walmart, MatterHackers, Bambu Lab store. Prices change daily; check the link before buying."],
        ["Refresh", "Every Sunday the weekly task searches again, adds this week's best prices to the history and rebuilds this file and the console page."],
        ["Add an item", "Add rows to hq/data/supplies/c3d-supplies.csv (or hq/data/filament/prices.csv for filament), then run python3 hq/scripts/build-filament.py."],
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

    money = '"$"#,##0.00'
    ws = wb.create_sheet("Summary")
    sheet(ws, ["Group", "Item", "Best price", "Per", "Pack", "Pack price", "Store", "Stars", "Reviews", "Link"],
          [20, 40, 11, 8, 12, 11, 24, 7, 9, 44], "1E3A5F")
    def tint(row, group):
        for c in ws[row]:
            c.fill = PatternFill("solid", fgColor=GROUPS[group][1])
        ws.cell(row, 1).font = Font(bold=True, color=GROUPS[group][0])
    for p in prices:
        o = p["top"][0]
        ws.append(["Filament", f'{p["brand"]} {p["type"]}', o["per_kg"], "kg", f'{o["kg"]:g} kg', o["price"], o["store"],
                   p["rating"] or "", p["reviews"] or "", o["url"]])
        tint(ws.max_row, "Filament")
    for sp in supplies:
        o = sp["top"][0]
        per = o["price"] if o["unit"] == "printer" else o["per_unit"]
        ws.append([sp["group"], sp["item"], per, o["unit"], o["pack"], o["price"], o["store"], o["rating"] or "", o["reviews"] or "", o["url"]])
        tint(ws.max_row, sp["group"])
    for r in range(2, ws.max_row + 1):
        ws.cell(r, 3).number_format = '"$"#,##0.000' if (ws.cell(r, 3).value or 0) < 1 else money
        ws.cell(r, 6).number_format = money
        ws.cell(r, 10).hyperlink = ws.cell(r, 10).value
    ws.auto_filter.ref = ws.dimensions

    for g in [g for g in GROUPS if g != "Filament"]:
        ws = wb.create_sheet(g.replace("&", "and") if len(g) > 31 else g)
        sheet(ws, ["Item", "Rank", "Price per unit", "Per", "Pack", "Pack price", "Store", "Product", "Stars", "Reviews", "Checked", "Link"],
              [38, 6, 13, 8, 12, 11, 18, 44, 7, 9, 11, 44], GROUPS[g][0])
        for sp in [x for x in supplies if x["group"] == g]:
            for i, o in enumerate(sp["top"], 1):
                ws.append([sp["item"] if i == 1 else "", i, o["per_unit"], o["unit"], o["pack"], o["price"], o["store"], o["product"],
                           o["rating"] or "", o["reviews"] or "", o["checked"], o["url"]])
                r = ws.max_row
                ws.cell(r, 3).number_format = '"$"#,##0.000' if o["per_unit"] < 1 else money
                ws.cell(r, 6).number_format = money
                ws.cell(r, 12).hyperlink = o["url"]
                if i == 1:
                    for c in ws[r]:
                        c.fill = PatternFill("solid", fgColor=GROUPS[g][1])
                    ws.cell(r, 1).font = Font(bold=True)

    # Price history: one table and one line graph per group. Each weekly build adds a row.
    ws = wb.create_sheet("Price history")
    ws.sheet_properties.tabColor = "1E3A5F"
    dates = sorted({h["date"] for h in history})
    item_order = [f'{p["brand"]} {p["type"]}' for p in prices] + [sp["item"] for sp in supplies]
    for j in range(2, 30):
        ws.column_dimensions[get_column_letter(j)].width = 14
    row = 1
    for g in GROUPS:
        hs = [h for h in history if h["group"] == g]
        if not hs:
            continue
        seen = {h["item"] for h in hs}
        items = [i for i in item_order if i in seen] + sorted(seen - set(item_order))
        if g == "Filament":
            items = [i for i in items if i.endswith(" PLA") or i.endswith(" PETG")]  # keep the graph readable
        unit = "per kg" if g == "Filament" else "printer price" if g == "Bambu Lab printers" else "per unit"
        ws.cell(row, 1, f"{g} ({unit})").font = Font(bold=True, size=12, color=GROUPS[g][0])
        ws.cell(row + 1, 1, "Week")
        for j, it in enumerate(items, 2):
            ws.cell(row + 1, j, it)
        ws.row_dimensions[row + 1].height = 45
        for c in ws[row + 1]:
            if c.value:
                c.alignment = Alignment(wrap_text=True, vertical="center")
                c.font = Font(bold=True, color="FFFFFF")
                c.fill = PatternFill("solid", fgColor=GROUPS[g][0])
        look = {(h["date"], h["item"]): h["best"] for h in hs}
        for k, d in enumerate(dates):
            ws.cell(row + 2 + k, 1, d)
            for j, it in enumerate(items, 2):
                v = look.get((d, it))
                if v is not None:
                    ws.cell(row + 2 + k, j, v).number_format = money
        ch = LineChart()
        ch.title = f"{g}: best price {unit}"
        ch.height, ch.width = 7.5, 22
        ch.y_axis.title = "USD"
        ch.add_data(Reference(ws, min_col=2, max_col=len(items) + 1, min_row=row + 1, max_row=row + 1 + len(dates)), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=row + 2, max_row=row + 1 + len(dates)))
        for se in ch.series:
            se.marker.symbol = "circle"
        ws.add_chart(ch, f"{get_column_letter(len(items) + 3)}{row}")
        row += max(len(dates) + 4, 17)
    ws.column_dimensions["A"].width = 12

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
    ws = wb.create_sheet("Filament prices")
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
    first = ["Read me", "Summary", "Filament prices", "Light box parts", "Packing & shipping", "Bambu Lab printers", "Price history", "Wholesale & bulk"]
    wb._sheets.sort(key=lambda w: first.index(w.title) if w.title in first else len(first))
    for name in ["Filament prices", "All offers", "Wholesale & bulk", "Polymaker PLA", "Mockup palette", "Product specs", "All colors", "Brands"]:
        wb[name].sheet_properties.tabColor = "0F766E"
    old = os.path.join(OUT, "filament-tracker.xlsx")
    if os.path.exists(old):
        os.remove(old)
    wb.save(os.path.join(OUT, "c3d-supplies-sheet.xlsx"))
    keys = ["brand", "type", "finish", "line", "color", "hex", "hex2", "td", "source"]
    slim = [{k: v for k, v in p.items() if k != "offers"} for p in prices]
    json.dump({"updated": today, "brands": brands, "palette": palette, "prices": slim, "suppliers": suppliers,
               "supplies": supplies, "groups": CONSOLE_COLORS,
               "history": [[h["date"], h["group"], h["item"], h["best"]] for h in history],
               "keys": keys, "colors": [[r[k] for k in keys] for r in colors]},
              open(os.path.join(OUT, "filament.json"), "w"), separators=(",", ":"))
    print(f"{len(brands)} brands, {len(colors)} colors, {pm_pla} Polymaker PLA, {len(prices)} price rows, {len(palette)} palette colors, {len(supplies)} supplies, {len(history)} history rows")


if __name__ == "__main__":
    main()
