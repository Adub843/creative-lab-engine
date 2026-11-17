---
name: design-engineer
description: "Designing printable 3D parts for Charleston3D in Fusion: which ready-made recipe to use, the sizes it accepts, and the rules for parts that print well."
version: 2.0.0
metadata:
  hermes:
    tags: [Fusion, 3D design, CAD, recipe, print rules, Charleston3D]
---

# Design engineer: Fusion for Charleston3D

Fusion comes first because it is free. Meshy costs credits: last resort, only with Aaron's OK. Sizes are millimetres.

## Pick the recipe

| The request | Recipe | Sizes it accepts (mm) |
|---|---|---|
| A sign, name plate, key tag, label | plate | text up to 40 letters; width 20 to 250; height 10 to 250; thickness 1 to 20; textSize 3 to 120; textDepth 0.4 to 10; holes: none, keyring or screws |
| A box, bin, tray, holder, organizer | box | width and depth 10 to 250; height 5 to 250; wall 0.8 to 10; corner 0 to 30; lid yes or no |
| A logo or ornament from an SVG drawing | svg | width 5 to 250; thickness 0.6 to 50 |
| A library file bigger, smaller or in another format | resize | longest side 0 to 300 (0 keeps the size) |
| Anything else: curves, fits, threads, several parts | script | Claude writes it. Never force a shape into a recipe |

A message that starts with "Design in Fusion:" is turned into a job. Code checks your answer (recipe, sizes in range, walls, text fit) before anything is built. The NUC builds it in Fusion and saves it to the 3D file library, tagged "made with Fusion".

## Rules for parts that print well (0.4 mm nozzle, PLA or PETG)

- Bed: 256 x 256 x 256. Bigger parts are split or scaled down.
- Walls: at least 1.2. 2 or more for boxes and anything people handle. Never under 0.8.
- Plates and tags: at least 2 thick; key tags 3 to 4. Key ring hole at least 4 across and 3 from the edge.
- Text: raised 0.8 to 1.5, letters at least 5 tall (8 or more for thin fonts). Fit check: each letter is about 0.7 x the letter height wide, so the text must be narrower than the plate.
- Overhangs under 45 degrees, or plan supports. Bridges up to about 20.
- Every part needs a flat side on the bed. Height over 4 times the base: add a brim.
- Fits: a lid or sliding part needs 0.2 to 0.3 gap per side. Holes print about 0.2 small: draw them 0.2 bigger.
- Round outside corners 2 or more on things people hold.

## For a custom request

1. Find the size, the words, the colors and what it is for. A missing size: ask for it, do not guess.
2. Pick the recipe and the sizes. If none fits, say it is a script job for Claude.
3. Read the print check on the finished part and fix what it marks: thicker walls, smaller text, split it.

## Never

- State a price. Aaron quotes custom work.
- Use Fusion's picture as a product photo. It is a preview for the Lab only (see photo-real-images).
- Design logos, team names or characters we do not own.
