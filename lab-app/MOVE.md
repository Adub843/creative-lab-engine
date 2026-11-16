# Switch-over: claude.ai Lab → Lab server

Run once the server is installed (INSTALL.md) and Aaron says go. Claude does every step except the ones marked **Aaron**.
Nothing on claude.ai is deleted: the artifact stays as a read-only fallback for two weeks.

## 1. Freeze (5 minutes)
- Tell Aaron, Shana and Josh not to change anything in the claude.ai Lab during the move.
- Pause Stacy's cloud scheduled tasks (`update_trigger` enabled=false), noting which were on.

## 2. Page files
- `Artifact list scope:"files"` on https://claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK, then `Artifact read paths:[…]` (≤256 per call) for all of them.
- Copy them into the repo's `lab/` folder (index.html at `lab/index.html`), open a PR. Text tweaks in the same PR, so messages fit the new home:
  - `js/engine.js` `why()`: "Add the Cloudflare connector in claude.ai Settings › Connectors" → "The Lab server's Cloudflare token isn't set."
  - "Open the console on claude.ai" / "Open the page in Claude" messages → "Sign in to the Lab again."
- **Aaron** merges; the server pulls it within 5 minutes.

## 3. Database
1. `node scripts/find-collections.mjs lab` lists every collection the code names (105 on 2026-11-15). There are no
   subcollections except each person's `data/users/<id>/…`.
2. For each collection: `ArtifactData list collection:<name> out_dir:<export> query:{limit:1000}`, following `next_cursor` until it's empty.
   Also `data/users/me` (Aaron's own PIN and private notes). Shana's and Josh's private folders can only be read by them; they set a new PIN on first sign-in.
3. Copy `<export>` to the server and run
   `sudo -u lab npm run admin -- import-db <export> <Aaron's u_ id>=aaron,me=aaron`
   (the u_ id is the folder name under `data/users/`). Every u_ id inside documents is swapped too.
4. Spot-check counts: `ArtifactData list` totals vs `sqlite3 /srv/lab/data/lab.db "select coll,count(*) from docs group by coll"`.

## 4. Files
- `Artifact list scope:"assets"` (follow `after`), then `Artifact read path:<id> out_dir:<files>` for each.
- `sudo -u lab npm run admin -- import-assets <files>`. Ids stay the same, so every `/_blob/<id>` link in the data keeps working.

## 5. Stacy's shifts
- `list_triggers` (all pages) → save as `triggers.json` → `sudo -u lab npm run admin -- import-jobs triggers.json` (all imported switched off).
- In each prompt, replace ArtifactData instructions with the `lab` tools (`get`, `list`, `set`, `update`, `delete`, `upload_file`; same paths).
- Turn them on one at a time from the Lab (Apps & Agents › Stacy's shifts), watch the first run's log in `/srv/lab/data/runner-logs/`, then leave the matching cloud task off.

## 6. Check three times
- Every page at 1280 and 390 wide, side by side with the claude.ai Lab (Playwright script `test/` + screenshots), three passes.
- Live checks: an engine action (Products page loads), an upload and its picture, "Ask Stacy", a Stacy shift run, a passkey sign-in on Aaron's phone.
- Only then tell Aaron it's done, with the screenshots.
