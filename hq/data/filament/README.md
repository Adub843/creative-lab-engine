# Filament tracker data (Charleston 3D)

Feeds the Charleston 3D > Filament page in Creative Lab Studios and the Excel sheet
`hq/public/data/filament-tracker.xlsx`. Rebuild both with:

    python3 hq/scripts/build-filament.py

## Files

- `polymaker-official.csv`: Polymaker's own hex codes and TD (wiki.polymaker.com, "HEX codes and transmission distances"). Mockups use these first.
- `community/*.json`: SpoolmanDB (github.com/Donkie/SpoolmanDB, MIT). Every other brand's colors and hex codes.
- `prices.csv`: one row per offer: `brand,type,store,kind,pack_kg,price_usd,rating,reviews,product,url,checked`. `kind` is single, bulk or wholesale. Types: PLA, Matte PLA, Silk PLA, PLA+, PETG, ABS, ASA, TPU 95A. The build ranks offers by price per kg (price / pack_kg), before shipping and tax.
- `ratings.csv`: average stars and review count per brand and type (`brand,type,avg_rating,reviews,source,checked`), weighted by reviews across that brand and type's Amazon search results.
- `suppliers.csv`: wholesale and bulk programs (minimum order, discount, what a reseller needs, how to apply).

## Weekly refresh (scheduled task, Sundays)

1. Colors: `git clone --depth 1 https://github.com/Donkie/SpoolmanDB` and copy its `filaments/*.json` over `community/`.
2. Polymaker: read the wiki page (append `.md`), one product line at a time, and update `polymaker-official.csv` (add new colors, fix changed hex codes). Keep the same columns.
3. Prices: rewrite `prices.csv` with today's date in `checked`. For each brand and type, record the cheapest single 1 kg spool and the cheapest bulk box (by $/kg) at each source:
   - Brand stores, single and bulk boxes: Shopify stores answer `/products.json` (ELEGOO us.elegoo.com, Overture overture3d.com, Polymaker shop.polymaker.com, SUNLU store.sunlu.com).
   - Polymaker US Wholesale (us-wholesale.polymaker.com/products.json).
   - Bambu Lab, Prusa and Creality stores.
   - Amazon search: price, pack size from the title, stars and review count. Skip listings whose title isn't that brand (for example "for Bambu Lab AMS"), and read "250g x 4" packs as 1 kg.
   - Walmart and MatterHackers.
   Amazon, Walmart and most brand stores only load in Aaron's Chrome (Claude in Chrome); from the cloud, use what loads. Never solve a robot check or CAPTCHA; skip that store. Keep last week's row for a store you couldn't reach, with its old date. Update `ratings.csv` from the Amazon results and recheck the programs in `suppliers.csv`.
4. Run the build, check the summary line, commit to `claude/filament-tracker`, and copy the xlsx to project files `filament/`.
