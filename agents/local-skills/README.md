# local-skills: the short skill cards for Alice and Steve

Aaron, 2026-11-16: "make sure Alice is trained and ready and her files and rules are built right so she can read them",
and "update the new skills to her local model as well".

The 13 company skills in `Creative Lab HQ/Business Handoff/04 Skills/skills` are written for Claude and are far too long
for the 4B model on the Blink. These are the same knowledge cut down to one short card each (under 3,600 characters),
with nothing stale in them: no Business console, photo-real images only, the $2 a day ad cap, rule 21.

- **One source:** every card's text is in `build.py`. Run `python agents/local-skills/build.py` to write the `SKILL.md` files. Never edit a `SKILL.md` by hand; the test fails if it differs from `build.py`.
- **Where they are installed (the Blink):** `~/.hermes/skills/aaron/<name>/SKILL.md` for Alice and `~/.hermes/profiles/business/skills/aaron/<name>/SKILL.md` for Steve. Copy with scp; no restart needed for the cards.
- **How Alice reads them:** not by choosing a skill herself (a small model does not do that reliably). `agents/alice-web/playbooks.py` picks the card in code and puts it in front of the question. Steve still loads them as Hermes skills and his code checker reads every answer.
- **Cards:** aaron-business, company-rules, company-brand-kit, social-post, product-listing-copy, c3d-quote-triage, marketing-and-ads, seo-local, photo-real-images, ship-check, ideas-brief, daily-ops, system-map.
- **Rule 20:** when a rule, price rule, job or brand fact changes, change it in `build.py` the same day, run the build and the tests (`python -m unittest agents/alice-web/test_alice.py`), copy the card to both folders on the Blink, and ask Alice the question on her page.
- **To add a card:** add a `card(...)` in `build.py`, add its row to `ROUTES` in `playbooks.py`, add a real question to `BUSINESS` in `test_alice.py`.
- Nothing personal goes in a card. Alice's own instructions and memory stay only on the Blink.
