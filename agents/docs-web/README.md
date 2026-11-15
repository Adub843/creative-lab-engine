# Aaron's Documents page

Last updated: 2026-11-15.

Every document in one place, sorted into a few plain categories, with a search box. Click a document to open it.
Address: https://nuc-skull.tailb3d313.ts.net:8446/ (Aaron's own devices over Tailscale only). Linked from the
console's Ask bar ("Documents") and from "Aaron's Documents" on the NUC desktop.

- Runs on the NUC, where the files already are, so nothing is copied and the list is always current (rescanned
  every 2 minutes). Kept running by the Windows task "Creative Lab documents page". If the NUC is off, the page is off.
- Read-only. It lists and opens files; it cannot change, move or delete anything.
- Only the folders in `CATEGORIES` in `server.py`, only document types, never key or password files. A file is
  opened by an id from the list, never by a path.
- "Start here" is the short list at the top (`START_HERE` in `server.py`): the master sheet, the two recovery
  guides, the open items list, the read-me, the rules and the marketing playbook.
- To add a folder or a category, edit `CATEGORIES`, then end the task's python process (the task restarts it
  within 5 minutes) or run `python agents/docs-web/server.py`.
- PDFs and pages open in the browser. Word and Excel files download and open in their own app. Notes open as text.
