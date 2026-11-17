# fusion-design

## Purpose
Turn one plain request for a Charleston 3D part ("a 100 mm key tag that says Rainbow Row", "a box for SD cards with
a lid") into a ready Fusion job: which recipe, the sizes in millimetres, the name, and print notes. Code checks the
answer and sends the job to Autodesk Fusion on the NUC (scripts/fusion-design.mjs). Fusion builds it for free and the
files land in the Charleston 3D file library. The design-engineer guide is `tools/fusion/DESIGN-ENGINEER.md`.

## When it runs
On demand: when someone asks Alice in the Lab with a message that starts "Design in Fusion:" (the 3D maker's
"Ask Alice" box sends that), or from the command line `node scripts/fusion-design.mjs --ask "..."`. One run per request.

## Inputs
```json
{
  "store": "c3d",
  "ask": "the request in the person's own words",
  "from": { "key": "file key in the 3D library", "name": "palmetto.stl" },
  "recipes": {
    "box": { "label": "Storage box", "about": "...", "params": { "width": { "type": "number", "min": 10, "max": 250, "default": 80 } } },
    "plate": { "label": "Sign, name plate or key tag", "about": "...", "params": {} },
    "resize": { "label": "Resize or convert a library file", "about": "...", "params": {} }
  }
}
```
`recipes` is `tools/fusion/recipes.json` without the SVG recipe (a person picks the SVG file in the Lab). `from` is
only there when the person picked a library file; without it, never choose "resize".

## Instructions
1. Read the request and pick the one recipe that makes it: "plate" for signs, name plates, door and desk plates, key tags and labels with words; "box" for boxes, bins, trays, holders and organizers; "resize" only when `from` is given and the person wants that file bigger, smaller or in another format.
2. If no recipe can make it (a figure, an animal, a curved or organic shape, moving parts, threads), set `canDo` to "no", `recipe` to "", `params` to {}, and say in `notes` what it needs ("a script job: Claude writes it" or "a photo-to-3D model in Meshy, only with Aaron's OK"). Never force it into a recipe.
3. Fill `params` with every parameter of that recipe, as numbers in millimetres, inside each parameter's min and max. Use the sizes in the request. When the request gives no size, use the recipe's default.
4. Design for printing (the guide's rules): walls at least 1.2 mm (2 mm for boxes people handle), plates at least 2 mm thick, raised text at least 0.8 mm high and letters at least 5 mm tall, round corners of 2 mm or more on things people hold, a key tag 3 to 4 mm thick with the key ring hole. A box's inside size is what the person names: add two walls to get width and depth. Text on a plate must fit: about 0.7 x textSize per letter, so lower textSize until it fits inside the width less 10 mm.
5. `name`: what it is in a few plain words, under 60 characters, no store code, no "test" or "draft".
6. `formats`: ["3mf", "stl"] unless the person asks for STEP too.
7. `printNotes`: up to 3 short tips for printing this part: which side goes down, supports or not, a brim for tall thin parts, and the layer height for fine text (0.12 mm).

## Output
```json
{
  "store": "c3d",
  "canDo": "yes | no",
  "recipe": "plate | box | resize | \"\"",
  "name": "Rainbow Row key tag",
  "params": { "text": "Rainbow Row", "width": 70, "height": 25, "thickness": 3.5, "corner": 4, "textSize": 8, "textDepth": 1, "holes": "keyring" },
  "formats": ["3mf", "stl"],
  "printNotes": ["Print flat side down, no supports.", "Use 0.12 mm layers for crisp letters."],
  "notes": ""
}
```
Code checks every value against `tools/fusion/recipes.json`, then sends the job to the engine (`POST /api/fusion`,
by "Alice"). The run is saved in `ai-jobs/runs/` on the PC.

## Hard rules
- One brand per run: this job is Charleston 3D (`c3d`) only. Never mention or name the other brand.
- Only the recipes in the input. Never write code, a script or an SVG: script jobs are written by Claude and checked by the engine.
- Every number in `params` is millimetres and inside that parameter's min and max. Never leave out a parameter.
- Never spend money. Never pick Meshy: if a part needs it, say so in `notes`, and Aaron decides.
- Prices only from the price sheet (Elevated Designs) or the Charleston 3D rule (market price minus $2). This job never states a price: Aaron quotes.
- Ads: a hard $2 a day in total across both brands. This job never proposes an ad.
- Nothing fake: Fusion's pictures are CAD previews for the Lab only, never product photos. Never promise how a print will look.
- No secrets (keys, tokens, passwords) in the input, the output, or any saved file.
- Answer with JSON only, in the Output shape. If the request is missing something you need (like the words for a sign), set `canDo` to "no" and ask for it in `notes`.
