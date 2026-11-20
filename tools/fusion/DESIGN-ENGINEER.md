# Design engineer guide: Fusion for Charleston 3D

For Alice, Stacy and any Claude session that designs printable parts. Fusion comes first because it is free; Meshy
costs credits and is the last resort, only with Aaron's OK. Every step below is a plain script or a Lab button.

## The tools

| Need | Tool | Who |
|---|---|---|
| A sign, name plate, key tag, label | Recipe `plate` (Lab: Make ▸ 3D maker ▸ Fusion) | anyone, Alice |
| A box, bin, tray, holder, organizer | Recipe `box` | anyone, Alice |
| A logo, cookie-cutter blank, ornament from a drawing | Recipe `svg` (pick an SVG file) | anyone |
| A library file bigger, smaller or in another format | Recipe `resize`, or the **Fusion** button on any file in Charleston 3D ▸ Print files | anyone, Alice |
| Anything else (curves, fits, threads, multi-part) | `recipe: "script"` with a `make(design, root, P)` Python function, helpers in `LabBridge/labkit.py` | Claude writes it |
| Turn a request in words into the best part | "Ask Alice" in the 3D maker ("Design in Fusion: ..."), or `node scripts/fusion-best.mjs --ask "..." [--send]`: Claude designs (recipe or script), code checks, Fusion test-builds, print check, fixes go back to Claude (3 rounds); the local model is the backup | Alice (Claude first) |
| The local model alone (recipes only) | `node scripts/fusion-design.mjs --ask "..." [--send]` | Alice |
| Check a file before printing | `node scripts/print-check.mjs part.stl [--bed 256x256x256]` (runs on every Fusion part) | anyone, Alice |
| Remake a folder of files as clean 3MF/STL | `node scripts/fusion-batch.mjs --src ... --names ... --out ...` | NUC |
| Rebuild a flat-layered STL as an editable Fusion design (.f3d) | `python scripts/stl-to-fusion-script.py` then `fusion-batch.mjs --jobs` | Claude |

Jobs go to `/api/fusion`; the NUC builds them in Fusion and saves the files to the 3D file library, tagged
"made with Fusion", plus a copy in `Aaron-Data\01 Charleston3D\Made in Fusion`.

## Rules for parts that print well (FDM, 0.4 mm nozzle, PLA/PETG, Bambu Lab printer)

- **Bed:** 256 x 256 x 256 mm. Bigger parts get split or scaled down.
- **Walls:** at least 1.2 mm (three lines); 2 mm or more for boxes and anything people handle. Never under 0.8 mm.
- **Plates and tags:** at least 2 mm thick; key tags 3 to 4 mm. Key ring hole at least 4 mm across and 3 mm from the edge.
- **Text:** raised 0.8 to 1.5 mm, letters at least 5 mm tall (8 mm or more for thin fonts). Print text with 0.12 mm layers.
  Rough fit check: each letter is about 0.7 x the letter height wide.
- **Overhangs:** keep them under 45 degrees from vertical, or plan supports. Bridges up to about 20 mm print clean.
- **Flat base:** every part needs a flat side on the bed. Turn the part so the biggest flat face goes down.
- **Tall and thin:** if the height is over 4 times the base, add a brim.
- **Fits:** a lid or a part that slides into another needs 0.2 to 0.3 mm gap per side (the box recipe uses 0.3 mm).
  Press fits 0.1 mm. Holes print about 0.2 mm small: draw them 0.2 mm bigger.
- **Corners:** round outside corners 2 mm or more on things people hold; inside corners on boxes 1 mm or more.
- **Sizes are millimetres** everywhere in the Lab and the recipes. Inside a script, Fusion works in centimetres: use `mm()` from labkit.

## Workflow for a custom request

1. Read the request (Charleston 3D ▸ Custom quotes). Find the size, the words, the colors, what it's for.
2. Pick the recipe. If none fits, it is a script job: Claude writes it; never force a shape into a recipe.
   "Ask Alice" does steps 2 and 3 for you, the best way (Aaron, 2026-11-19: "everything we make should be the best
   design ... every time"): Claude designs it, Fusion test-builds it on the NUC, the print check reads it and the built
   size must match the size Claude gave; only a part that passes goes to the Lab.
3. Send it (3D maker, "Ask Alice", or `fusion-best.mjs --send`).
4. Read the print check on the finished part. Fix anything marked: thicker walls, smaller text, split it.
5. Download the 3MF into Bambu Studio, slice and print. Fusion's picture is a CAD preview for the Lab only,
   never a product photo (product photos follow the real-photo method).
6. Prices: never from this guide. Aaron quotes custom work; store prices follow the Charleston 3D rule.

## Improving a model from a reference photo

Measure from the photo with a known size in it (a coin, a ruler, the customer's stated size). Write the main sizes
down in millimetres first, then pick the recipe or ask Claude for a script with those sizes. Meshy photo-to-3D only
when the shape is organic (a figure, an animal) and Aaron says yes to the credits.
