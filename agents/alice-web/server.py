#!/usr/bin/env python3
"""Alice web chat: a private chat page for Alice (Hermes on the Blink).

Listens on 127.0.0.1 only. `tailscale serve` publishes it to the tailnet over HTTPS
(never Funnel). The Hermes API key stays here, server-side; browsers never see it.

/talk is Aaron's phone page: talk or type to Alice. Notes are saved, actions get done (Claude takes
over any action Alice has not finished in 60 s). Log: ~/Desktop/Alice/inbox.jsonl.
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = Path.home() / ".hermes" / ".env"
LISTEN = ("127.0.0.1", 8650)
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
# Pages allowed to call /api/* from a browser: claude.ai artifact frames (the Creative Lab Studio console).
ORIGIN_RE = re.compile(r"^https://([a-z0-9-]+\.)*(claudeusercontent\.com|claude\.ai)$")


# ---- team notes board (agents/team-notes in the repo): shared with Steve; business only ----
import sys as _sys
_sys.path.insert(0, str(Path.home() / "team-notes"))
_sys.path.insert(0, str(Path(__file__).resolve().parent))   # python -I does not add this folder itself
import websearch
import remember
import quick
try:
    import team_notes
except Exception:                      # the board is optional: without it nothing changes
    class team_notes:                  # noqa: N801
        told = staticmethod(lambda text: None)
        add = staticmethod(lambda *a, **k: None)
        prefix_for = staticmethod(lambda *a, **k: "")


def hermes_env():
    vals = {}
    for line in ENV.read_text().splitlines():
        m = re.match(r"^(API_SERVER_(?:KEY|PORT))=(.*)$", line.strip())
        if m:
            vals[m.group(1)] = m.group(2).strip().strip('"')
    return vals


# The small model sometimes invents what is on Aaron's calendar or in his mail when he only said hello.
# So: a greeting is marked as a greeting, and an answer that talks about his calendar, mail or meetings when he
# did not ask about them is sent back once, and if it still does, those sentences are taken out.
_GREET_RE = re.compile(r"^\s*(?:hey|hi|hello|yo|sup|good (?:morning|afternoon|evening|night)|what'?s up|how(?:'s| is) it going|how are you)\b", re.I)
_ASKED_PRIVATE_RE = re.compile(r"\b(e-?mail|inbox|gmail|calendar|schedule|appointment|meeting|event|remind|task|to-?do|agenda|today|tomorrow|this week)\b", re.I)
_CLAIM_RE = re.compile(r"\b(calendar|meeting|appointment|inbox|unread|e-?mails?|tasks? (?:queued|pending|waiting)|scheduled)\b", re.I)


def _honest(asked, reply):
    """True when the reply does not claim things about his calendar or mail that he did not ask about."""
    return bool(_ASKED_PRIVATE_RE.search(asked)) or not _CLAIM_RE.search(reply or "")


def _strip_claims(reply):
    keep = [x for x in re.split(r"(?<=[.!?])\s+", reply or "") if not _CLAIM_RE.search(x)]
    return " ".join(keep).strip() or "Good. What can I do for you?"


def ask_alice(message, session):
    # "Remember ...", "forget ..." and "what do you remember about me" are done in code, so they really happen.
    done = quick.handle(message, save_note=lambda e: append_log(e), read_notes=lambda: read_log())
    if done is not None:
        return done
    done = remember.handle(message)
    if done is not None:
        return done
    # A lookup question gets a real web search first, run here in code, so she answers from live results.
    try:
        found = websearch.prefix_for(message)
    except Exception:
        found = ""
    asked = message
    hello = "[This is only a greeting. Answer with one short friendly sentence. Do not mention his calendar, mail, tasks or the business.]\n\n" if _GREET_RE.match(message) and len(message.split()) <= 10 else ""
    message = found + remember.prefix() + team_notes.prefix_for(message) + hello + message
    env = hermes_env()
    req = urllib.request.Request(
        f"http://127.0.0.1:{env.get('API_SERVER_PORT', '8642')}/v1/chat/completions",
        data=json.dumps({"model": "hermes-agent", "messages": [{"role": "user", "content": message}]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {env['API_SERVER_KEY']}",
                 "X-Hermes-Session-Id": session})
    def call(text):
        rq = urllib.request.Request(req.full_url, data=json.dumps({"model": "hermes-agent", "messages": [{"role": "user", "content": text}]}).encode(), headers=dict(req.header_items()))
        with urllib.request.urlopen(rq, timeout=600) as r:
            return json.load(r)["choices"][0]["message"]["content"]
    reply = call(message)
    if not _honest(asked, reply):
        reply = call("[Your last answer mentioned his calendar, mail, meetings or tasks, but he did not ask about them and you did not check them. Answer again without any of that.]\n\n" + message)
        if not _honest(asked, reply):
            reply = _strip_claims(reply)
    return reply


# ---------------- Alice on the phone: talk or type; notes get saved, tasks get done ----------------
# Each message is sorted first by a small JSON call to the same model (LM Studio runs 2 slots, so this
# doesn't evict Hermes's cached prompt). Notes are saved here (and copied into the Creative Lab Studio's
# Notepad by Claude). Tasks Alice's tools can do (Gmail / Calendar) go to her; she gets 60 s, and her "done"
# only counts if the Gmail/Calendar bridge logged a successful call. Anything else is handed to Claude (status "handoff").
import threading
import time
import datetime

LOG_DIR = Path.home() / "Desktop" / "Alice"          # Alice's own shared folder, so she can read it too
LOG = LOG_DIR / "inbox.jsonl"
AUDIT_LOG = Path.home() / ".local" / "state" / "qwen-google" / "audit.log"
LMSTUDIO = "http://127.0.0.1:1234/v1/chat/completions"
MODEL = "qwen/qwen3-4b-2507"
ALICE_LIMIT = 60          # seconds Alice gets for a task before Claude takes over
KINDS = ["note", "task", "chat"]
CATEGORIES = ["Note", "Lab Fix", "Lab Idea", "To-Do", "Reminder", "Question"]
log_lock = threading.Lock()
pending = {}              # entry id -> late answer, for the phone to pick up

SORT_PROMPT = """Sort one message Aaron sent his assistant Alice from his phone. Reply ONLY with JSON.
kind:
- note: he wants it written down or remembered: a thought, info, an idea, a fix or update for the Creative Lab Studio (his business console, websites, shops, tools) to do later. "note", "remember", "idea", "we should", "need to fix".
- task: he wants something done or looked up now: send/read/check email, calendar (what's on, add, move, cancel), find, make, write, change, order, research, post.
- chat: greetings, opinions, general questions, talk.
who (tasks only, else "none"): "alice" ONLY if it is about his Gmail (search, read, send an email to himself) or his Google Calendar. Everything else: "claude".
category: Note, Lab Fix (fix or change for the Creative Lab Studio), Lab Idea (new product, design, feature or marketing idea), To-Do, Reminder (has a date or time), Question.
title: max 8 words. clean: his words tidied into one or two sentences (fix dictation slips, keep his meaning, add nothing)."""

SORT_SCHEMA = {"type": "json_schema", "json_schema": {"name": "entry", "strict": True, "schema": {
    "type": "object", "additionalProperties": False,
    "required": ["kind", "who", "category", "title", "clean"],
    "properties": {
        "kind": {"type": "string", "enum": KINDS},
        "who": {"type": "string", "enum": ["alice", "claude", "none"]},
        "category": {"type": "string", "enum": CATEGORIES},
        "title": {"type": "string"},
        "clean": {"type": "string"}}}}}

TASK_WRAP = ("Aaron asked you, from his phone, to do this now. Use your Gmail or Google Calendar tools "
             "(find them with tool_search if needed). Never say you did or found something unless a tool "
             "returned it. Then answer in one or two short sentences (it may be read aloud).\n\nAaron: ")
ALICE_WORDS = re.compile(r"\b(e-?mails?|gmail|inbox|calendar|schedule|appointments?|meetings?|events?)\b", re.I)
CHAT_WRAP = "[Aaron, from his phone. Keep it short, 1-3 sentences; it may be read aloud.]\n"


def sort_entry(text):
    req = urllib.request.Request(LMSTUDIO, headers={"Content-Type": "application/json"}, data=json.dumps({
        "model": MODEL, "temperature": 0.1, "max_tokens": 300, "response_format": SORT_SCHEMA,
        "messages": [{"role": "system", "content": SORT_PROMPT}, {"role": "user", "content": text}]}).encode())
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(json.load(r)["choices"][0]["message"]["content"])
    out["kind"] = out.get("kind") if out.get("kind") in KINDS else "chat"
    out["who"] = out.get("who") if out.get("who") in ("alice", "claude") else "claude"
    out["category"] = out.get("category") if out.get("category") in CATEGORIES else "Note"
    if out["kind"] == "task" and ALICE_WORDS.search(text):
        out["who"] = "alice"          # Gmail / Calendar: Alice's own tools
    out["title"] = str(out.get("title", ""))[:120] or text[:60]
    out["clean"] = str(out.get("clean", ""))[:4000] or text
    return out


def google_calls_since(offset):
    """Successful Gmail/Calendar calls Alice made since `offset` bytes into the bridge's audit log.
    Only these count as Alice really doing a task (she sometimes answers without a working tool call)."""
    try:
        with AUDIT_LOG.open("rb") as f:
            f.seek(offset)
            new = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return 0
    ok = 0
    for line in new:
        try:
            if json.loads(line).get("ok", True) is not False:
                ok += 1
        except ValueError:
            pass
    return ok


def audit_size():
    try:
        return AUDIT_LOG.stat().st_size
    except OSError:
        return 0


def read_log():
    if not LOG.exists():
        return []
    rows = []
    for line in LOG.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def append_log(entry):
    with log_lock:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(json.dumps(entry) + "\n")


def update_log(entry_id, **changes):
    with log_lock:
        rows = read_log()
        for r in rows:
            if r.get("id") == entry_id:
                r.update(changes)
        tmp = LOG.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
        tmp.replace(LOG)


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def handle_talk(text, session):
    _t = team_notes.told(text)
    if _t:
        return {"kind": "chat", "status": "chat", "reply": ("Posted to the team board. Steve and I will both see it on our next answer: " + _t) if team_notes.add("aaron", _t, by="aaron") else "I did not post that: it is already on the board, or it looks like a password or key, which never goes there."}
    # On the talk page too, lookups are answered, not handed off: a question for the web, the time, a sum,
    # "remember ..." and "take a note ..." go straight to the same code steps as the main chat.
    try:
        direct = (websearch.needs_web(text) or quick.handle(text) is not None
                  or remember.SAVE_RE.match(text) or remember.LIST_RE.search(text) or remember.FORGET_RE.match(text)
                  or quick.NOTE_RE.match(text) or quick.NOTES_LIST_RE.match(text))
    except Exception:
        direct = False
    if direct:
        return {"kind": "chat", "status": "chat", "reply": ask_alice(text, "alice-phone-" + session)}
    s = sort_entry(text)
    now = datetime.datetime.now().astimezone()
    e = {"id": now.strftime("%Y%m%d%H%M%S") + os.urandom(2).hex(), "when": now.strftime("%Y-%m-%d %H:%M"),
         "at": now.isoformat(timespec="seconds"), "said": text, **s}
    hsession = "alice-phone-" + session

    if s["kind"] == "note":
        e.update(status="saved", console=False)
        append_log(e)
        return {"id": e["id"], "kind": "note", "status": "saved",
                "reply": f"Saved to your notes as a {s['category']}: {s['title']}."}

    if s["kind"] == "chat":
        return {"kind": "chat", "status": "chat", "reply": ask_alice(CHAT_WRAP + text, hsession)}

    if s["who"] == "claude":
        e.update(status="handoff", handoff_at=now_iso(), why="not something Alice's tools can do")
        append_log(e)
        return {"id": e["id"], "kind": "task", "status": "handoff",
                "reply": f"That one needs Claude, so I've handed it over: {s['title']}."}

    # A Gmail / Calendar task: Alice gets a minute, and only a real tool call counts as done.
    e.update(status="alice")
    append_log(e)
    box, done, started, mark = {}, threading.Event(), time.time(), audit_size()

    def work():
        try:
            box["reply"] = ask_alice(TASK_WRAP + text, hsession)
            box["tools"] = google_calls_since(mark)
        except Exception as ex:
            box["error"] = ex.__class__.__name__
        done.set()
        if box.get("late"):
            if box.get("tools"):
                update_log(e["id"], alice_late=box["reply"][:2000])
                pending[e["id"]] = {"kind": "task", "reply": "Late, but I did it: " + box["reply"]}

    threading.Thread(target=work, daemon=True).start()
    if done.wait(ALICE_LIMIT) and "reply" in box:
        secs = round(time.time() - started)
        if box.get("tools"):
            update_log(e["id"], status="done", by="alice", reply=box["reply"][:2000], secs=secs)
            return {"id": e["id"], "kind": "task", "status": "done", "reply": box["reply"]}
        update_log(e["id"], status="handoff", handoff_at=now_iso(), why="Alice answered without using a tool",
                   alice_said=box["reply"][:1000])
        return {"id": e["id"], "kind": "task", "status": "handoff",
                "reply": "I couldn't actually do that with my tools, so Claude is taking it over."}
    box["late"] = True
    update_log(e["id"], status="handoff", handoff_at=now_iso(),
               why=f"Alice didn't finish in {ALICE_LIMIT} s" if "error" not in box else "Alice errored")
    return {"id": e["id"], "kind": "slow", "status": "handoff",
            "reply": "That's taking me over a minute, so Claude is taking it over. If I finish, I'll say so here."}


STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/talk": ("talk.html", "text/html; charset=utf-8"),
    "/avatar.png": ("avatar.png", "image/png"),
    "/icon-192.png": ("icon-192.png", "image/png"),
    "/apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
}
# Alice on screen: two short clips, reused for every answer (resting, talking).
CLIPS = {"/alice-idle.mp4": "alice-idle.mp4", "/alice-talk.mp4": "alice-talk.mp4"}


class Handler(BaseHTTPRequestHandler):
    server_version = "AliceWeb"

    def cors(self):
        origin = self.headers.get("Origin", "")
        if ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def send_clip(self, name):
        f = HERE / name
        if not f.exists():
            return self.send(404, {"error": "not found"})
        size = f.stat().st_size
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(size - int(m.group(2)), 0)
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            code = 206
        with open(f, "rb") as fh:
            fh.seek(start)
            data = fh.read(end - start + 1)
        self.send_response(code)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Accept-Ranges", "bytes")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send(204, b"", "text/plain")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in STATIC:
            name, ctype = STATIC[path]
            self.send(200, (HERE / name).read_bytes(), ctype)
        elif path in CLIPS:
            self.send_clip(CLIPS[path])
        elif path == "/api/health":
            try:
                ok = urllib.request.urlopen("http://127.0.0.1:1234/v1/models", timeout=3).status == 200
            except Exception:
                ok = False
            self.send(200, {"ok": True, "model_server": ok})
        elif path.startswith("/api/late/"):
            self.send(200, {"late": pending.pop(path[10:], None)})
        elif path == "/api/log":
            rows = [r for r in read_log() if r.get("kind") in ("note", "task")][-30:]
            rows.reverse()
            self.send(200, {"entries": rows})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/api/chat", "/api/talk"):
            return self.send(404, {"error": "not found"})
        origin = self.headers.get("Origin", "")
        same = origin == f"https://{self.headers.get('Host', '')}"
        if self.path == "/api/talk" and origin and not same:
            return self.send(403, {"error": "origin not allowed"})
        if origin and not ORIGIN_RE.match(origin) and not same:
            return self.send(403, {"error": "origin not allowed"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 64_000)))
            message = str(body.get("message", "")).strip()
            session = str(body.get("session", ""))
        except (ValueError, AttributeError):
            return self.send(400, {"error": "bad request"})
        if self.path == "/api/talk":
            if not message or not SESSION_RE.match(session):
                return self.send(400, {"error": "say or type something first"})
            try:
                return self.send(200, handle_talk(message[:8000], session))
            except Exception as e:
                return self.send(502, {"error": f"Couldn't reach Alice: {e.__class__.__name__}"})
        if not message or not SESSION_RE.match(session):
            return self.send(400, {"error": "message and session are required"})
        _t = team_notes.told(message)
        if _t:
            return self.send(200, {"reply": ("Posted to the team board. Steve and I will both see it on our next answer: " + _t) if team_notes.add("aaron", _t, by="aaron") else "I did not post that: it is already on the board, or it looks like a password or key, which never goes there."})
        try:
            self.send(200, {"reply": ask_alice(message, "alice-web-" + session)})
        except urllib.error.HTTPError as e:
            self.send(502, {"error": f"Alice's server answered {e.code}"})
        except Exception as e:
            self.send(502, {"error": f"Couldn't reach Alice: {e.__class__.__name__}"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chdir(HERE)
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()
