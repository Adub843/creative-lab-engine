# Filament tracker data (Charleston 3D)

Feeds the Charleston 3D > Filament page in Creative Lab Studios and the Excel sheet
`hq/public/data/filament-tracker.xlsx`. Rebuild both with:

    python3 hq/scripts/build-filament.py

## Files

- `polymaker-official.csv`: Polymaker's own hex codes and TD (wiki.polymaker.com, "HEX codes and transmission distances"). Mockups use these first.
- `community/*.json`: SpoolmanDB (github.com/Donkie/SpoolmanDB, MIT). Every other brand's colors and hex codes.
- `prices.csv`: one row per brand, type and store: `brand,type,store,price_usd,note,url,checked`. Types: PLA, Matte PLA, Silk PLA, PLA+, PETG, ABS, ASA, TPU 95A. Price is a single 1 kg spool, before shipping and tax.

## Weekly refresh (scheduled task, Sundays)

1. Colors: `git clone --depth 1 https://github.com/Donkie/SpoolmanDB` and copy its `filaments/*.json` over `community/`.
2. Polymaker: read the wiki page (append `.md`), one product line at a time, and update `polymaker-official.csv` (add new colors, fix changed hex codes). Keep the same columns.
3. Prices: rewrite `prices.csv` with today's date in `checked`. Sources in order: the brand's official store, Amazon, Walmart, MatterHackers. Amazon and Walmart only load in Aaron's Chrome (Claude in Chrome); from the cloud, use the official stores and MatterHackers. Keep last week's row for a store you couldn't reach, with its old date.
4. Run the build, check the summary line, commit to `claude/filament-tracker`, and copy the xlsx to project files `filament/`.
