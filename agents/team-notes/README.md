# Team notes: how the local agents stay in the loop

Last updated: 2026-11-15.

Alice and Steve are not running all the time. Each one wakes only when it is asked something, so they cannot call
each other. Instead there is one shared board on the Blink, `~/team-notes/notes.jsonl`. Code writes a note the
moment something is learned, and every agent is handed the latest notes at the top of its next question. There is
no scan or schedule in between: a note written now is in front of the other agent on its very next answer.

| Who writes | When | Kind |
|---|---|---|
| Steve's rule checker (`agents/steve-web/server.py`) | The moment it rejects one of his answers | lesson |
| Aaron, by saying or typing "tell the team: ..." to Steve, Alice or the console's Ask box | At once | aaron |
| The NUC (`scripts/sync-agent-context.ps1`, task "Creative Lab context sync", every 5 minutes) | When CLAUDE.md or MARKETING-CONTEXT.md changes | rules |

Who reads: Steve on every question; Alice and the console's Ask box on business questions only (personal questions
are left alone). Notes older than 14 days drop off, and each answer is handed the latest 8.

Rules of the board:
- Business only. Alice's mail, calendar and personal notes never go on it. A model never writes to it on its own.
- Anything that looks like a password, key or card number is refused.
- The same note twice is dropped.

Files: `team_notes.py` (the board), `post_note.py` (post from a script: text on standard input),
`patch_alice.py` (connects Alice's page and the console's Ask box; safe to run again, makes backups).
`agents/steve-web/deploy.sh` copies all three to the Blink. Tests are in `agents/steve-web/test_rules.py`.

The rules sync also copies the changed file to Steve's folder on the Blink and checks that every numbered hard
rule in CLAUDE.md is in Steve's `SOUL.md`. A missing rule is posted to the board and logged in
`Creative Lab HQ/05 Tools/Blink/context-sync-log.txt` for Claude to add (rule 20).
