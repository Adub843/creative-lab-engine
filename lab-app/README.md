# Lab app (self-hosted)

The Lab (Creative Lab Studios console) as an installable app on Aaron's own server, instead of a claude.ai artifact.
The Lab's page files run **unchanged**. `web/runtime.js` gives them the same six built-ins they had on claude.ai,
answered by this server:

| Built-in | On claude.ai | Here |
|---|---|---|
| `db` | artifact database (1 GB, shared) | `server/db.mjs`: SQLite on the server, same paths, rules, queries, leases and live updates (Server-Sent Events) |
| `assets` | 1 GB / 20 MB per file | `server/assets.mjs`: files on the Synology, 50 GB per file by default, streamed with Range (videos seek) |
| `sample` | Claude | `server/ai.mjs`: Alice first for plain questions, then Claude (API key or the Claude command line on Aaron's plan); page tools still run in the page |
| `mcp` | claude.ai connectors | `server/connectors.mjs`: Stacy's shifts (`server/runner.mjs`), Kittl, and the engine's Cloudflare calls through an allowlist (queue + 2 buckets only) |
| `user` | claude.ai account | `server/auth.mjs`: Aaron (owner), Shana, Josh; passkey sign-in, 30-day device sessions |
| `downloads` | save dialog | browser download |

Also: app manifest, icons and an offline start screen (`web/`), big read-only NAS libraries (`/_lab/lib`, `/_lib/...`),
an agent API with narrow keys (`/_lab/api/*`) and the `lab` MCP server Stacy's shifts use (`server/lab-mcp.mjs`).

Nothing is opened to the internet: the server listens on 127.0.0.1 and Tailscale serves it over HTTPS to Aaron's devices.
The engine Worker, the stores, the shirt apps and public pages stay on Cloudflare/Shopify/GitHub Pages.

- Install: [INSTALL.md](INSTALL.md) · Switch-over from claude.ai: [MOVE.md](MOVE.md)
- Tests: `npm test` (server, rules, live updates, files, passkeys, AI tool loop, engine allowlist, runner, imports; Chromium for the browser parts)
- Admin (typed at the server): `npm run setup-code -- aaron`, `npm run agent-key -- stacy aaron db,assets`, `npm run admin` for the rest
