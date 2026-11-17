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


def main():
    req = json.load(sys.stdin)
    c = conf()
    client = anthropic.Anthropic(api_key=c["ANTHROPIC_API_KEY"], max_retries=2, timeout=200.0)
    ping = bool(req.get("ping"))
    args = dict(
        model=c.get("ALICE_CLAUDE_MODEL", "claude-opus-5-5"),
        max_tokens=64 if ping else 16000,
        system=[{"type": "text", "text": req["system"], "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": "low" if ping else c.get("ALICE_CLAUDE_EFFORT", "medium")},
    )
    if not ping:
        args["tools"] = TOOLS
    messages = list(req["messages"])
    msg = None
    for _ in range(4):                                   # a long web lookup can pause; send it back to continue
        msg = once(client, dict(args, messages=messages))
        if msg.stop_reason != "pause_turn":
            break
        messages = messages + [{"role": "assistant", "content": msg.content}]
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
