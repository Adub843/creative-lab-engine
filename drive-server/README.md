# E: drive library server

The Creative Lab engine's **E: drive** page (Library, E: drive) lists every design file on Aaron's E: drive, plus Kittl
and the old design lab images, without copying them anywhere. This folder is the small server that runs on the
PC and hands the console search results, previews and downloads through a free Cloudflare Tunnel
(`library.epix3d.com`; the name is from the Design Studio days and can later move to a console hostname). Nothing on E: is ever moved, changed or deleted.

- **Elevated Designs** sees every image, SVG, DTF/halftone print, logo and source file (AI, EPS, PDF, DXF, CDR) and Kittl.
- **Charleston3D** sees its own folders (Print files, Comercial downloaded 3d print files) and every 3D model (STL, 3MF, OBJ, STEP).
- The Elevated Designs shirt app (design.elevatedshirts.com) gets the pictures in the E: folders listed in
  `SHIRT_APP_FOLDERS` (`config.mjs`), through the console's `GET /api/drive/public`. Nothing else on E: is public.
  The server reads that list once per index (a few seconds at start) and then pages, searches and filters it from
  memory, so the app can show all of it page by page. Previews are made a few at a time, newest request first.
- Same name and size in two places counts as one file, shown once with how many copies exist.
- The page works while the PC is on and E: is plugged in. When it isn't, the page says so.

## Set up (once)

Double-click **Set up design library.cmd** on the Desktop (it runs `setup.ps1` in this folder:
`creative-lab-engine\drive-server\setup.ps1`). It asks for two things only: signing in to Cloudflare in
the browser, and the console key (CONSOLE_KEY) in a hidden prompt, which Windows encrypts for your account. It then
starts the server and tunnel now and at every sign-in (scheduled task "Design Library").

## Day to day

- New files on E:: run `node build-index.mjs` in this folder (or re-run the setup). The server switches to the new index within a minute.
- Index, previews and the encrypted key live in `%LOCALAPPDATA%\design-library`.
- Moving to the Beelink: copy this repo, plug in E:, run the setup there.

## How it's secured

The server listens on 127.0.0.1 only. Every request must carry a signature made with CONSOLE_KEY by the console
Worker (`lib/drive.mjs`), checked here (`lib.mjs`), and the Worker only signs for someone who has the console key.
It answers GET only.
