# Charleston 3D supplies sheet data

Feeds the Charleston 3D > Supplies page in Creative Lab Studios and the Excel sheet
`hq/public/data/c3d-supplies-sheet.xlsx`. Filament is limited to 3 brands: Polymaker (first), Bambu Lab and ELEGOO (`KEEP_BRANDS` in the build script). Rebuild both with:

    python3 hq/scripts/build-filament.py

## Files

- `polymaker-official.csv`: Polymaker's own hex codes and TD (wiki.polymaker.com, "HEX codes and transmission distances"). Mockups use these first.
- `community/*.json`: SpoolmanDB (github.com/Donkie/SpoolmanDB, MIT). Every other brand's colors and hex codes.
- `prices.csv`: one row per offer: `brand,type,store,kind,pack_kg,price_usd,rating,reviews,product,url,checked`. `kind` is single, bulk or wholesale. Types: PLA, Matte PLA, Silk PLA, PLA+, PETG, ABS, ASA, TPU 95A. The build ranks offers by price per kg (price / pack_kg), before shipping and tax.
- `ratings.csv`: average stars and review count per brand and type (`brand,type,avg_rating,reviews,source,checked`), weighted by reviews across that brand and type's Amazon search results.
- `suppliers.csv`: wholesale and bulk programs (minimum order, discount, what a reseller needs, how to apply).

- `../supplies/c3d-supplies.csv`: every other supply (`group,item,store,product,pack,units,unit,price_usd,rating,reviews,url,checked`). Groups: Light box parts (white LED strips: battery, USB plug-in, 12V wall plug; foil tape), Packing & shipping (boxes 6x4x4, 9x6 mailer, 12x9x6; honeycomb packing paper; heavy duty packing tape; fragile labels; desiccant packs), Bambu Lab printers (base price on us.store.bambulab.com/collections/3d-printer). `units` is the count in the pack (ft, boxes, rolls, labels, packets) so the build ranks by unit price.
- `../supplies/history.csv`: written by the build. One row per item per run with the best price; the price graphs read it. Never edit old rows.

## Weekly refresh (scheduled task, Sundays)

1. Colors: `git clone --depth 1 https://github.com/Donkie/SpoolmanDB` and copy its `filaments/*.json` over `community/`.
2. Polymaker: read the wiki page (append `.md`), one product line at a time, and update `polymaker-official.csv` (add new colors, fix changed hex codes). Keep the same columns.
3. Prices (Polymaker, Bambu Lab and ELEGOO only): rewrite `prices.csv` with today's date in `checked`. For each brand and type, record the cheapest single 1 kg spool and the cheapest bulk box (by $/kg) at each source:
   - Brand stores, single and bulk boxes: Shopify stores answer `/products.json` (ELEGOO us.elegoo.com, Polymaker shop.polymaker.com).
   - Polymaker US Wholesale (us-wholesale.polymaker.com/products.json).
   - Bambu Lab store (us.store.bambulab.com), including bulk refill packs.
   - Amazon search: price, pack size from the title, stars and review count. Skip listings whose title isn't that brand (for example "for Bambu Lab AMS"), and read "250g x 4" packs as 1 kg.
   - Walmart and MatterHackers.
   Amazon, Walmart and most brand stores only load in Aaron's Chrome (Claude in Chrome); from the cloud, use what loads. Never solve a robot check or CAPTCHA; skip that store. Keep last week's row for a store you couldn't reach, with its old date. Update `ratings.csv` from the Amazon results and recheck the programs in `suppliers.csv`.
4. Supplies: for each item in `c3d-supplies.csv`, search Amazon again (and Uline or Walmart if they load) and keep the 3 best by unit price among listings rated 4.3 stars or more with 50+ reviews. Read pack size from the title. Re-read the Bambu Lab printer prices; add new models.
5. Run the build, check the summary line, commit to `claude/filament-tracker`, and copy `hq/public/data/c3d-supplies-sheet.xlsx` to project files `supplies/Charleston 3D supplies sheet.xlsx`.
