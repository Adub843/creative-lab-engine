# alice-web: Alice's chat pages on the Blink

Alice is Aaron's personal agent. These are her two pages and the code that does her everyday actions. They run on
the Blink (`~/alice-web`, user service `alice-web`, port 8650, shared to the tailnet at https://blink.tailb3d313.ts.net/
and `/talk`). This folder is a copy of the code for backup and review. It holds no instructions file, no notes and no
personal data; those live only on the Blink (`~/.hermes/SOUL.md`, `~/Desktop/Alice/`) and are never put in git.

Aaron's rule (2026-11-15): her core actions are code, not prompts, so they always happen and she has less to read.

| File | What it does |
|---|---|
| `server.py` | The page server. `ask_alice` runs the code steps below in order, then asks the model, then the honesty guard. Serves the two video clips with byte ranges. |
| `quick.py` | Answered by code with no model call: the time and date, sums and percentages, "take a note ...", "show my notes". |
| `remember.py` | "Remember ...", "forget ...", "what do you remember about me". Saved in `~/Desktop/Alice/remembered.md`; the list goes in front of every question. Secrets are refused. |
| `websearch.py` | A lookup question gets a real web search first (DuckDuckGo through Hermes's Python) and the results go in front of the question. Personal statements, commands, emails, phone numbers and street addresses are never searched; "near me" becomes the home city only. |
| `index.html` | Main chat: purple and black, Alice on screen (resting clip, talking clip while her voice plays), microphone, voice, quick actions (beside her on a PC, behind Menu on a phone), she tucks into the top bar when the chat fills up. |
| `talk.html` | Phone talk page: notes get saved, tasks get done, same on-screen Alice. |

Order inside `ask_alice`: quick, remember, web search, saved-facts prefix, team notes prefix, greeting marker, model,
honesty guard (an answer that talks about his calendar or mail when he did not ask is retried once, then trimmed).

Traps:
- The service runs `python3 -I`, so the folder is added to `sys.path` in `server.py` before the local imports.
- Hermes's Python folder name changes on updates; `websearch.py` finds it by searching for one that can import `ddgs`.
- The two clips (`alice-idle.mp4`, `alice-talk.mp4`) and the portrait are in `Creative Lab HQ\05 Tools\Blink\Alice portrait` on the NUC.
- To put a change live: copy the file to `~/alice-web/` on the Blink and `systemctl --user restart alice-web`. Test with a real question before telling Aaron.
