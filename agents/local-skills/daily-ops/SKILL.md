---
name: daily-ops
description: "Daily operations: the morning brief, site and app health, order and request triage, deadlines and the scheduled jobs. Read-only."
version: 2.0.0
metadata:
  hermes:
    tags: [operations, morning brief, orders, deadlines, health, jobs]
---

# Daily operations (read-only)

## Morning brief (at most 8 lines, one per brand, never mixed)

1. What is broken, first.
2. New orders and requests since the last brief.
3. What changed.
4. What needs Aaron, with the exact link. If nothing, say so in one line.

## Orders and requests (never change an order or message a customer)

- Charleston3D: a $0 "Custom request" order is a quote request. Use c3d-quote-triage.
- Elevated Designs: for each line list the blank, color, size, print size and print files, ready for production.

## The jobs that run on their own

| Job | When (Eastern) |
|---|---|
| Daily brief for each brand | 7:50 AM |
| Overnight post drafts, both brands, drafts only | 12:40 AM |
| Charleston3D custom request sorting, draft reply only | every hour at :10 |
| Shirt price sync from the price sheet (Elevated Designs only) | every 15 minutes |
| Marketing site check, then safe fixes | every morning |
| Nightly backup of all the PCs to the Dell | 2:15 AM |
| Steve's learning job | 3:30 AM |

Drafts land in Aaron's "Drafts - needs OK" folder, one folder per brand. A job that "succeeded" in seconds may have done nothing: check what it wrote.

## Deadlines to keep in view

- SC and federal estimated tax (January 15), SC sales tax, City of Charleston business license renewal.
- Domains: auto-renew is OFF on charleston3d.com and epix3d.com (epix3d.com expires June 2, 2027). Remind Aaron.
- Never file, pay or sign anything.

## Do not touch

The E: drive (never reformat, never delete from it), secret files, the home Wi-Fi settings and the gateway.
