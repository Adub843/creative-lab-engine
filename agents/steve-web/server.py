#!/usr/bin/env python3
"""Steve web chat: a private chat page for Steve, the business agent (Hermes profile "business" on the Blink).

Listens on 127.0.0.1 only. `tailscale serve` publishes it to the tailnet over HTTPS (never Funnel).
The Hermes API key stays here, server-side; browsers never see it. Steve only drafts and answers:
he has no tools to publish, spend or reach Aaron's personal mail, calendar or Alice's files.

Every answer goes through rules_check.py before Aaron sees it. An answer that breaks a rule is sent back to
Steve once with the reasons; if the second try still breaks one, Aaron gets a plain "I stopped" note instead.
Price questions are answered from the live stores' own prices (prices.py). Each check is logged in
~/Desktop/Business/checker-log.jsonl so the rejected answers can be used to improve Steve's instructions.
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import datetime
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prices            # noqa: E402  live prices from the two stores
import rules_check       # noqa: E402  the rule checker

HERE = Path(__file__).resolve().parent
HERMES = Path.home() / ".hermes"
LISTEN = ("127.0.0.1", 8651)
PROFILE = "business"
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
# Pages allowed to call /api/chat from a browser: claude.ai artifact frames (the Creative Lab Studios console).
ORIGIN_RE = re.compile(r"^https://([a-z0-9-]+\.)*(claudeusercontent\.com|claude\.ai)$")
SPOKEN = "[Aaron is using voice. Keep it to 1-3 short sentences; it will be read aloud.]\n"


def env_value(path, name):
    for line in path.read_text().splitlines():
        m = re.match(rf"^{name}=(.*)$", line.strip())
        if m:
            return m.group(1).strip().strip('"')
    return None


LOG = Path.home() / "Desktop" / "Business" / "checker-log.jsonl"
log_lock = threading.Lock()


def call_hermes(message, session):
    port = env_value(HERMES / ".env", "API_SERVER_PORT") or "8642"
    key = env_value(HERMES / "profiles" / PROFILE / ".env", "API_SERVER_KEY")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/p/{PROFILE}/v1/chat/completions",
        data=json.dumps({"model": "hermes-agent", "messages": [{"role": "user", "content": message}]}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                 "X-Hermes-Session-Id": session})
    with urllib.request.urlopen(req, timeout=900) as r:
        body = json.load(r)
    return rules_check.strip_emoji(body["choices"][0]["message"]["content"])


def log_check(row):
    try:
        with log_lock:
            LOG.parent.mkdir(parents=True, exist_ok=True)
            with LOG.open("a") as f:
                f.write(json.dumps(row) + "\n")
    except OSError:
        pass


MODEL_ID = "console-8b"        # Steve's own model in LM Studio (business-model.service loads it)


def model_loaded(model=MODEL_ID):
    """True when Steve's own model is loaded. If it is not, LM Studio would quietly answer with whatever model is
    loaded (Alice's), so Steve refuses instead: the two agents never share a model by accident."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:1234/api/v0/models", timeout=5) as r:
            return any(m.get("id") == model and m.get("state") == "loaded" for m in json.load(r).get("data", []))
    except Exception:
        return False


def ensure_model():
    """Start the model loader once if the model is missing (the graphics chip can drop it), then say whether it is up."""
    if model_loaded():
        return True
    try:
        subprocess.run(["systemctl", "--user", "restart", "business-model.service"], timeout=240, check=False)
    except Exception:
        pass
    return model_loaded()


def ask_steve(asked, session, spoken=False, call=call_hermes):
    """One checked turn. Returns {reply, checked, fixed, blocked, problems}."""
    if call is call_hermes and not ensure_model():
        return {"reply": "My model is not loaded on the Blink right now, so I can't answer. It usually comes back within "
                         "five minutes by itself. If it does not, see the recovery guide: Steve does not answer.",
                "checked": False, "fixed": False, "blocked": True, "problems": ["model not loaded"]}
    stores = sorted(rules_check.brands(asked)) or ["c3d", "ed"]
    # A price question may only use the prices of the products it was shown; anything else, any listed price.
    note, shown = prices.price_facts(asked, stores)
    allowed = shown if shown is not None else prices.allowed_prices(stores)
    urls = prices.product_urls()
    message = note + (SPOKEN if spoken else "") + asked
    reply = call(message, session)
    first = rules_check.check(reply, asked, allowed, urls)
    problems, fixed = first, False
    if first:
        reply2 = call("Your last answer broke these rules:\n- " + "\n- ".join(first)
                      + "\n\nWrite the whole answer again with every one of them fixed. Do not mention this correction.", session)
        problems = rules_check.check(reply2, asked, allowed, urls)
        if not problems:
            reply, fixed = reply2, True
    blocked = bool(problems)
    if first:
        log_check({"at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "asked": asked[:2000],
                   "first_problems": first, "fixed": fixed, "blocked": blocked, "final_problems": problems})
    return {"reply": rules_check.blocked_message(problems) if blocked else reply, "checked": True,
            "fixed": fixed, "blocked": blocked, "problems": problems if blocked else []}


STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "SteveWeb"

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

    def do_OPTIONS(self):
        self.send(204, b"", "text/plain")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in STATIC:
            name, ctype = STATIC[path]
            self.send(200, (HERE / name).read_bytes(), ctype)
        elif path == "/api/health":
            try:
                ok = urllib.request.urlopen("http://127.0.0.1:1234/v1/models", timeout=3).status == 200
            except Exception:
                ok = False
            self.send(200, {"ok": True, "model_server": ok})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/chat":
            return self.send(404, {"error": "not found"})
        origin = self.headers.get("Origin", "")
        same = origin == f"https://{self.headers.get('Host', '')}"
        if origin and not ORIGIN_RE.match(origin) and not same:
            return self.send(403, {"error": "origin not allowed"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 64_000)))
            message = str(body.get("message", "")).strip()
            session = str(body.get("session", ""))
            spoken = bool(body.get("spoken"))
        except (ValueError, AttributeError):
            return self.send(400, {"error": "bad request"})
        if not message or not SESSION_RE.match(session):
            return self.send(400, {"error": "message and session are required"})
        try:
            self.send(200, ask_steve(message[:8000], "steve-web-" + session, spoken))
        except urllib.error.HTTPError as e:
            self.send(502, {"error": f"Steve's server answered {e.code}"})
        except Exception as e:
            self.send(502, {"error": f"Couldn't reach Steve: {e.__class__.__name__}"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chdir(HERE)
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()
