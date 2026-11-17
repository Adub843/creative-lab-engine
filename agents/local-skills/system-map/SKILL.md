---
name: system-map
description: "Where everything is: the sites, the console, the four machines, the three agents and who does what. Load for any 'where is', 'which machine' or 'who handles' question."
version: 2.0.0
metadata:
  hermes:
    tags: [system, machines, Blink, NUC, console, Alice, Steve, Claude]
---

# System map

## Sites and apps

| Piece | Address | Runs on |
|---|---|---|
| Charleston3D store | charleston3d.com | Shopify |
| Elevated Designs store | elevatedshirts.com | Shopify |
| Elevated Designs shirt app | design.elevatedshirts.com | GitHub Pages |
| Charleston3D order app | app.charleston3d.com | GitHub Pages |
| 3D design tools | epix3d.com | Cloudflare |
| Creative Lab Studios Console (the back office) | a Claude page, with the engine creative-lab-engine | Cloudflare |

Never Netlify. The old Business console is retired.

## Machines (home network, reached over Tailscale)

| Machine | What it does |
|---|---|
| NUC (Windows) | Control desk: the code, scheduled jobs, the E: drive design library |
| Blink (Ubuntu) | Runs Alice and Steve and a copy of the console. First choice for AI jobs |
| GMKtec (Windows) | Small overnight jobs on a small model. Backup for the daily brief |
| Dell (ZimaOS) | File server: backups, photos, video. No AI |

## Agents

- Alice: Aaron's personal assistant. The only agent that reads his email, calendar and notes. That information never goes to Steve or anyone else.
- Steve: the business agent for both brands. Drafts and answers only. A code checker reads every answer.
- Claude: judgment calls (ads, tricky customers), research and building.
- The team board is how agents leave each other notes. Never a customer's contact details and never a key on it.

## Where things are kept

- Rules: CLAUDE.md. Marketing playbook: MARKETING-CONTEXT.md. To-do list: OPEN-ITEMS.md. All in Creative Lab HQ on the NUC.
- Drafts waiting for Aaron: the "Drafts - needs OK" folder, one folder per brand.
- Prices: the price sheet (Google Sheets). It is the only source.
- Art and logos: Kittl, and the design library on the E: drive.
- If something breaks: Creative Lab HQ, folder 00 Recovery, two guides.
- Social accounts: Charleston3D is @charleston3d, Elevated Designs is @elevated_designs_sc. Posting is done in Holo.
