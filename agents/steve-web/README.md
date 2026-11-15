# Steve, the business agent

Steve is the local business agent for Elevated Designs and Charleston3D. He runs on the Blink (Hermes profile
`business`, model `console-8b` in LM Studio on the Blink's graphics chip) and only drafts and answers: he has no
tools to publish, spend, message a customer, or reach Aaron's personal mail, calendar or Alice's files.

Last updated: 2026-11-15.

## Where Aaron talks to him

- His own chat page, with a talk button and spoken replies: https://blink.tailb3d313.ts.net:8444/ (Tailscale only).
- The console on the Blink: the Ask box has an Alice / Steve picker. It asks Steve through this same server.

## What is in this folder

| File | What it does |
|---|---|
| `server.py` | The chat page's server (127.0.0.1:8651). Every turn goes through the checker. |
| `rules_check.py` | The rule checker. Code reads every answer before Aaron sees it. |
| `prices.py` | Live prices and real product links, read from each store's public product feed. |
| `SOUL.md` | Steve's instructions: the 20 hard rules in short form, same numbers as CLAUDE.md. |
| `test_rules.py` | Unit tests for the checker, the prices and the checked turn. No network. |
| `trick-questions.json`, `run_trick_questions.py` | The trick questions asked of the live Steve. |
| `patch_console_web.py` | Adds Steve to the console's Ask box on the Blink. Safe to run again. |
| `learn.py` | The nightly learning job (3:30 AM on the Blink): lessons from rejected answers, kept only if the tests hold. |
| `askmic.js` | The Talk button for the console's Ask box. |
| `deploy.sh` | Runs the tests, copies everything to the Blink and restarts the page. |
| `steve-web.service`, `business-model.service`, `steve-learn.service`, `steve-learn.timer` | The Blink's start-up units for the page and the model. |

## How a turn works

1. If the message is about price, `prices.py` puts the matching products and their live prices at the top of it.
   Those are the only prices Steve may state. Aaron changes shirt prices in the price sheet's `your_price`
   column; the engine syncs the sheet to the store and Steve reads the store, so nothing is typed in twice.
2. Steve answers.
3. `rules_check.check()` reads the answer. It rejects: the other brand in a one-brand piece (rule 3), a price
   that is not listed (10), an ad budget over $2.00 a day (16), a phone number or street address (11), Netlify
   (2), another payment service (4), a made-up link or an invented claim such as a delivery time (1), a
   placeholder or a working note in customer text (17), a claim that he posted or changed something (9), and a
   request for a password or key (8). Emoji are removed.
4. A rejected answer goes back to Steve once with the reasons. If the second try still breaks a rule, Aaron sees
   a plain "I stopped" note with the reason instead of the bad text.
5. Every rejection is logged on the Blink in `~/Desktop/Business/checker-log.jsonl`. Read it when improving
   `SOUL.md`: it is the list of what Steve actually gets wrong.

## Changing anything (rule 20)

1. Edit the file here. A new hard rule goes in `Creative Lab HQ\CLAUDE.md` first, then in `SOUL.md` with the same
   number, then as a check in `rules_check.py` with a test, then as a trick question.
2. `python -m unittest agents/steve-web/test_rules.py`
3. `bash agents/steve-web/deploy.sh`
4. On the Blink: `python3 ~/steve-web/run_trick_questions.py`. Every line must say PASS. "checker fixed it" is
   fine; "checker blocked it" is safe but means Steve could not do that job, so improve `SOUL.md`.

This folder is outside `tools/` on purpose: the site build publishes everything in `tools/`, and Steve's code is not for the public.

Result on 2026-11-15: 30 unit tests pass; 22 of 22 trick questions safe (the checker fixed 5 and blocked 1).
