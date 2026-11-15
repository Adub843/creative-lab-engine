#!/usr/bin/env python3
"""Aaron's Documents page: every document in one place, sorted into a few plain categories, click to open.

Runs on the NUC, where the documents already are, so nothing is copied and the page is always current.
Listens on 127.0.0.1 only; `tailscale serve` publishes it to Aaron's own devices (never Funnel, never the
internet). Read-only: it lists and opens files, it cannot change, move or delete anything.

Only files inside the folders named in CATEGORIES are listed, only document types, and key or password files are
never listed. A file is opened by an id from the list, never by a path, so nothing outside the list can be reached.

    python agents/docs-web/server.py            start it (the task "Creative Lab documents page" does this)
"""
import hashlib
import html
import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path.home()
HQ = HOME / "OneDrive" / "Desktop" / "Creative Lab HQ"
AD = HOME / "Aaron-Data"
LISTEN = ("127.0.0.1", 8653)
CACHE_SECONDS = 120
MAX_BYTES = 60 * 1024 * 1024

DOC_TYPES = {".pdf": "PDF", ".docx": "Word", ".doc": "Word", ".rtf": "Word", ".xlsx": "Excel", ".xls": "Excel", ".csv": "Sheet",
             ".pptx": "Slides", ".md": "Note", ".txt": "Note", ".html": "Page", ".htm": "Page", ".url": "Link"}
# Opened in the browser; everything else is handed to the PC's own app (Excel, Word).
INLINE = {".pdf", ".html", ".htm"}
TEXT = {".md", ".txt", ".csv"}
SKIP_DIRS = {"node_modules", ".git", "dist", "__pycache__", "backups", "07 Code Backups", "06 OpenClaw Setup", "CLAUDE.md repo copies",
             "04 Skills", "retired-2026-10-30", "site-packages"}
SECRET_RE = re.compile(r"secret|password|passwd|credential|token|\.env$|\.pem$|\.kdbx$|id_rsa|id_ed25519|client_secret|\.dpapi$|api[-_ ]?key", re.I)

# The few things Aaron reaches for most, always at the top.
START_HERE = [
    (HQ / "03 Business Admin" / "Business License" / "Master Document - Elevated Designs & Charleston3D.xlsx", "Master sheet"),
    (HQ / "00 Recovery" / "1 System recovery guide.html", "Recovery guide 1: the system"),
    (HQ / "00 Recovery" / "2 Network and remote access guide.html", "Recovery guide 2: network and remote access"),
    (HQ / "00 Recovery" / "3 Change the Zima server sign-in.html", "Guide 3: change the Zima server sign-in"),
    (HQ / "OPEN-ITEMS.md", "Open items: the one to-do list"),
    (HQ / "00 READ ME FIRST.md", "Read me first: where everything is"),
    (HQ / "CLAUDE.md", "Your rules for every agent"),
    (HQ / "MARKETING-CONTEXT.md", "Marketing playbook"),
]
# name, the folders it shows, one line on what is in it
CATEGORIES = [
    ("Business paperwork", [HQ / "03 Business Admin" / "Elevated Designs Paperwork", HQ / "03 Business Admin" / "Business License",
                            HQ / "03 Business Admin" / "Elevated Designs LLC - Business Records", AD / "03 Business Admin"],
     "LLC, licenses, taxes, policies and forms"),
    ("Supplier accounts", [HQ / "03 Business Admin" / "Business Account Applications"], "Wholesale applications and the resale certificate"),
    ("Brand and marketing", [HQ / "01 Brand and Marketing"], "Sheets, brand files, cards and the print kit"),
    ("Elevated Designs", [AD / "02 Elevated Designs"], "Shirt business files"),
    ("Charleston3D", [HQ / "02 Charleston3D", AD / "01 Charleston3D"], "3D printing business files"),
    ("Guides and setup", [HQ / "00 Recovery", HQ / "04 Agents and Setup", HQ / "Business Handoff" / "01 Audit", HQ / "Business Handoff" / "02 System Map",
                          HQ / "Business Handoff" / "03 Agents", HQ / "Business Handoff" / "05 Runbooks", HQ / "Business Handoff" / "08 Project Files",
                          HQ / "Business Handoff" / "09 PC Cleanup Plan", HQ / "Business Handoff" / "10 Homelab"],
     "How things work and how to fix them"),
    ("Waiting for your OK", [AD / "_Drafts - needs OK"], "Drafts that need your approval"),
    ("Personal", [AD / "06 Personal"], "Your own files"),
]

_cache = {"at": 0, "docs": [], "by_id": {}}
_lock = threading.Lock()


def doc_id(path):
    return hashlib.sha1(str(path).lower().encode("utf-8")).hexdigest()[:16]


def nice(name):
    """A file name as a title: no extension, no leading status word or date clutter is removed (the name is his)."""
    return re.sub(r"\s+", " ", Path(name).stem.replace("_", " ")).strip()


def link_target(path):
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.upper().startswith("URL="):
                u = line[4:].strip()
                return u if re.match(r"^https?://", u) else None
    except OSError:
        pass
    return None


def entry(path, category, group, title=None):
    try:
        st = path.stat()
    except OSError:
        return None
    ext = path.suffix.lower()
    if ext not in DOC_TYPES or st.st_size > MAX_BYTES or SECRET_RE.search(path.name) or path.name.startswith("~$"):
        return None
    d = {"id": doc_id(path), "title": title or nice(path.name), "type": DOC_TYPES[ext], "ext": ext.lstrip("."), "category": category,
         "group": group, "modified": time.strftime("%Y-%m-%d", time.localtime(st.st_mtime)), "kb": max(1, st.st_size // 1024), "_path": path}
    if ext == ".url":
        d["url"] = link_target(path)
        if not d["url"]:
            return None
    return d


def scan():
    docs, seen = [], set()
    for path, title in START_HERE:
        e = entry(path, "Start here", "", title)
        if e:
            docs.append(e)
            seen.add(e["id"])
    for name, roots, _ in CATEGORIES:
        for root in roots:
            if not root.is_dir():
                continue
            for folder, dirs, files in os.walk(root):
                dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".") and "old working files" not in d.lower())
                rel = Path(folder).relative_to(root)
                group = root.name if str(rel) == "." else f"{root.name} / {rel.parts[0]}" if len(roots) > 1 else rel.parts[0]
                if len(roots) == 1 and str(rel) == ".":
                    group = ""
                for f in sorted(files):
                    e = entry(Path(folder) / f, name, group)
                    if e and e["id"] not in seen:
                        seen.add(e["id"])
                        docs.append(e)
    return docs


def library():
    with _lock:
        if time.time() - _cache["at"] > CACHE_SECONDS:
            docs = scan()
            _cache.update(at=time.time(), docs=docs, by_id={d["id"]: d for d in docs})
        return _cache


def public(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


VIEW_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>body{{margin:0;background:#f7f2e8;color:#1f2638;font:16px/1.6 "Segoe UI",system-ui,sans-serif}}
header{{background:#15223f;color:#f7f2e8;padding:14px 20px;display:flex;gap:16px;align-items:center}}header a{{color:#f7f2e8}}
h1{{font-size:18px;margin:0;font-weight:600}}pre{{max-width:980px;margin:20px auto;padding:20px 24px;background:#fffdf8;border:1px solid #e2d9c6;border-radius:10px;
white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.6 Consolas,"Cascadia Mono",monospace}}</style></head>
<body><header><a href="/">Documents</a><h1>{title}</h1></header><pre>{body}</pre></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "DocsWeb"

    def send(self, code, body, ctype="application/json", extra=None):
        data = body if isinstance(body, bytes) else (json.dumps(body) if not isinstance(body, str) else body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if u.path == "/icon.svg":
            return self.send(200, (HERE / "icon.svg").read_bytes(), "image/svg+xml")
        if u.path == "/api/docs":
            lib = library()
            cats = [{"name": "Start here", "about": "The few things you reach for most"}] + [{"name": n, "about": a} for n, _, a in CATEGORIES]
            return self.send(200, {"categories": cats, "docs": [public(d) for d in lib["docs"]]})
        if u.path in ("/file", "/view"):
            d = library()["by_id"].get((q.get("id") or [""])[0])
            if not d or not d["_path"].is_file():
                return self.send(404, "That document is not in the list any more.", "text/plain; charset=utf-8")
            path, ext = d["_path"], "." + d["ext"]
            if u.path == "/view" and ext in TEXT:
                body = html.escape(path.read_text(encoding="utf-8", errors="replace"))
                return self.send(200, VIEW_PAGE.format(title=html.escape(d["title"]), body=body), "text/html; charset=utf-8")
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            how = "inline" if ext in INLINE else "attachment"
            name = urllib.parse.quote(path.name)
            extra = {"Content-Disposition": f"{how}; filename*=UTF-8''{name}"}
            if ext in (".html", ".htm"):
                extra["Content-Security-Policy"] = "sandbox; default-src 'self' 'unsafe-inline' data:"
            return self.send(200, path.read_bytes(), ctype, extra)
        self.send(404, "Not found.", "text/plain; charset=utf-8")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(LISTEN, Handler)
    except OSError:
        sys.exit(0)            # already running
    server.serve_forever()
