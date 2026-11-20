"""One Claude call for Alice. Run by brain.py with the venv Python: JSON in on stdin, one JSON line out.

The key is read here, from a file only Aaron's user can read, and is never printed, logged or passed on.
"""
import json
import re
import sys
from pathlib import Path

import anthropic

KEY_FILE = Path.home() / ".config/alice/claude.env"
TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 6},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 4},
]


def conf():
    vals = {}
    for line in KEY_FILE.read_text().splitlines():
        m = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
        if m:
            vals[m.group(1)] = m.group(2).strip('"').strip("'")
    return vals


def once(client, args):
    """One request, streamed so a long answer cannot time out. A policy decline is re-run on a fallback model."""
    try:
        with client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **args) as s:
            return s.get_final_message()
    except anthropic.BadRequestError:
        with client.messages.stream(**args) as s:
            return s.get_final_message()


class Google:
    """Aaron's Gmail and Calendar tools: the same small program his local Alice uses (~/qwen-google/server.mjs),
    spoken to over its standard input and output. It can read mail, email only Aaron, and change only his own events.
    Its sign-in file is never read here."""

    def __init__(self):
        import subprocess
        self.p = subprocess.Popen(["node", str(Path.home() / "qwen-google/server.mjs")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.n = 0
        self.ask("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "alice-web", "version": "1"}})

    def ask(self, method, params=None):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}}) + "\n")
        self.p.stdin.flush()
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("google tools stopped")
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(str(msg["error"].get("message", "error"))[:200])
                return msg.get("result") or {}

    def tool_defs(self):
        return [{"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("inputSchema") or {"type": "object"}}
                for t in self.ask("tools/list").get("tools", [])]

    def call(self, name, arguments):
        try:
            r = self.ask("tools/call", {"name": name, "arguments": arguments or {}})
            return "\n".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text") or "(nothing)", bool(r.get("isError"))
        except Exception as e:
            return "Error: " + str(e)[:200], True

    def close(self):
        try:
            self.p.stdin.close()
            self.p.terminate()
        except Exception:
            pass


def main():
    req = json.load(sys.stdin)
    c = conf()
    client = anthropic.Anthropic(api_key=c["ANTHROPIC_API_KEY"], max_retries=2, timeout=200.0)
    ping = bool(req.get("ping"))
    args = dict(
        model=c.get("ALICE_CLAUDE_MODEL", "claude-opus-5-5"),
        max_tokens=64 if ping else int(req.get("max_tokens") or 16000),
        system=[{"type": "text", "text": req["system"], "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": "low" if ping else c.get("ALICE_CLAUDE_EFFORT", "medium")},
    )
    if not ping and req.get("tools", True):          # a job call (brain.job) is plain text in, text out: no web tools
        args["tools"] = TOOLS
    # Aaron's mail and calendar, only when brain.py asks for them (his switch is on and the message is about them).
    google = Google() if (not ping and req.get("google")) else None
    if google:
        args["tools"] = list(args.get("tools") or []) + google.tool_defs()
    messages = list(req["messages"])
    msg = None
    try:
        for _ in range(10):                              # web lookups can pause; mail and calendar tools take a turn each
            msg = once(client, dict(args, messages=messages))
            if msg.stop_reason == "pause_turn":
                messages = messages + [{"role": "assistant", "content": msg.content}]
                continue
            if msg.stop_reason == "tool_use" and google:
                results = []
                for b in msg.content:
                    if b.type == "tool_use":
                        text, bad = google.call(b.name, b.input)
                        results.append({"type": "tool_result", "tool_use_id": b.id, "content": text[:40000], "is_error": bad})
                messages = messages + [{"role": "assistant", "content": msg.content}, {"role": "user", "content": results}]
                continue
            break
    finally:
        if google:
            google.close()
    if msg.stop_reason == "refusal":
        return {"error": "declined"}
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    return {"reply": text, "model": msg.model} if text else {"error": "empty"}


if __name__ == "__main__":
    try:
        out = main()
    except (FileNotFoundError, KeyError):
        out = {"error": "no-key"}
    except anthropic.AuthenticationError:
        out = {"error": "bad-key"}
    except anthropic.PermissionDeniedError:
        out = {"error": "no-access"}
    except anthropic.RateLimitError:
        out = {"error": "busy"}
    except anthropic.BadRequestError as e:
        out = {"error": "request", "detail": str(getattr(e, "message", ""))[:200]}
    except anthropic.APIStatusError as e:
        out = {"error": "api-" + str(e.status_code)}
    except anthropic.APIConnectionError:
        out = {"error": "network"}
    except Exception as e:
        out = {"error": "worker-" + e.__class__.__name__}
    print(json.dumps(out))
