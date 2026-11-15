#!/usr/bin/env python3
"""Adds Steve to the Ask box of the console on the Blink (~/console-web). Safe to run again: each edit is skipped
when it is already there, and every file gets one dated backup before its first change.

    python3 ~/steve-web/patch_console_web.py     then     systemctl --user restart console-web

The console asks Steve through his own chat server (127.0.0.1:8651), so the rule checker reads every answer.
"""
import shutil
import sys
from pathlib import Path

ROOT = Path.home() / "console-web"
STAMP = ".bak-steve-2026-11-15"
done, skipped, missing = [], [], []


def patch(rel, marker, old, new, count=1):
    p = ROOT / rel
    s = p.read_text(encoding="utf-8")
    if marker in s:
        skipped.append(f"{rel}: {marker[:40]}")
        return
    if s.count(old) < 1:
        missing.append(f"{rel}: cannot find {old[:60]!r}")
        return
    bak = p.with_name(p.name + STAMP)
    if not bak.exists():
        shutil.copy2(p, bak)
    p.write_text(s.replace(old, new, count), encoding="utf-8")
    done.append(f"{rel}: {marker[:40]}")


# 1. server.py: a helper and the /api/steve route.
patch("server.py", "def ask_steve(",
      "def flatten_messages(m):",
      '''def ask_steve(message, session="console"):
    """Steve, the business agent, through his own chat server so the rule checker reads every answer."""
    req = urllib.request.Request("http://127.0.0.1:8651/api/chat", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"message": message, "session": session}).encode())
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)


def flatten_messages(m):''')
patch("server.py", 'if p == "/api/steve":',
      '            if p == "/api/mcp":',
      '''            if p == "/api/steve":
                j = self.jbody()
                msg = str(j.get("message") or "")[:4000]
                if not msg:
                    return self.err(400, "bad_request", "empty")
                try:
                    out = ask_steve(msg, session="console-" + (re.sub(r"[^a-z0-9]", "", str(j.get("who", "aaron")).lower())[:20] or "aaron"))
                except Exception as e:
                    log("steve error", e)
                    return self.err(503, "server_unavailable", "Steve didn't answer: " + type(e).__name__)
                return self.send(200, {"reply": out.get("reply", ""), "blocked": bool(out.get("blocked")), "fixed": bool(out.get("fixed"))})
            if p == "/api/mcp":''')

# 2. index.html: a picker in the Ask box, and a name on the answer box that follows it.
patch("static/index.html", 'id="askWho"',
      '<input type="text" id="askInput"',
      '<select id="askWho" class="rvsel" aria-label="Who to ask" title="Alice: your assistant. Steve: the business agent, every answer rule-checked."><option value="alice">Alice</option><option value="steve">Steve</option></select>\n      <input type="text" id="askInput"')
patch("static/index.html", 'id="ansWho"', '<div class="ans-head"><b>Alice</b>', '<div class="ans-head"><b id="ansWho">Alice</b>')
patch("static/index.html", 'id="askBtn">Ask</button>', 'id="askBtn">Ask Alice</button>', 'id="askBtn">Ask</button>')

# 3. company.js: send the question to whoever is picked.
JS = "static/js/company.js"
patch(JS, "const toSteve=",
      '$("#askBtn").disabled=true; ans.textContent="Alice is thinking… (she runs on the Blink, so a long answer can take a minute or two)";',
      'const toSteve=($("#askWho")||{}).value==="steve"; const whoB=$("#ansWho"); if(whoB) whoB.textContent=toSteve?"Steve":"Alice";\n'
      '  $("#askBtn").disabled=true; ans.textContent=toSteve?"Steve is working on it… (every answer is checked against your rules first)":"Alice is thinking… (she runs on the Blink, so a long answer can take a minute or two)";')
patch(JS, 'to:toSteve?"steve":"alice"',
      'to:"alice", text:q.slice(0,2000), at, via:"ask"', 'to:toSteve?"steve":"alice", text:q.slice(0,2000), at, via:"ask"')
patch(JS, '"/api/steve"',
      "const reply=await window.blink.askAlice(",
      'const reply=toSteve?(await window.blink.api("POST","/api/steve",{message:q,who})).reply:await window.blink.askAlice(')
patch(JS, 'from:toSteve?"steve":"alice"',
      'from:"alice", to:who.toLowerCase(), text:r.slice(0,4000)', 'from:toSteve?"steve":"alice", to:who.toLowerCase(), text:r.slice(0,4000)')
patch(JS, '(toSteve?"Steve":"Alice")+" couldn',
      'ans.textContent = "Alice couldn\'t answer just now ("', 'ans.textContent = (toSteve?"Steve":"Alice")+" couldn\'t answer just now ("')

# 4. Claude in the picker: the question is filed as a request handed to Claude (GET /api/handoffs lists them).
patch("static/index.html", '<option value="claude">',
      '<option value="steve">Steve</option></select>',
      '<option value="steve">Steve</option><option value="claude">Claude</option></select>')
patch(JS, 'value==="claude"',
      'const toSteve=($("#askWho")||{}).value==="steve";',
      'if(($("#askWho")||{}).value==="claude"){ const wb=$("#ansWho"); if(wb) wb.textContent="Claude"; const now=new Date().toISOString();\n'
      '    try{ if(!db) throw new Error("no database"); await db.collection("requests").add({for:"claude", by:me().toLowerCase(), status:"handoff", at:now, what:q.slice(0,1500), asked:q.slice(0,600), handoff:{to:"claude", why:"Asked Claude from the Ask box", at:now}});\n'
      '      const r="Sent to Claude. Claude is not live in this box: it picks this up on its next check, morning or evening, and the answer appears under Requests."; ans.textContent=r; speak(r); $("#askInput").value=""; }\n'
      '    catch(err){ ans.textContent="That did not save ("+((err&&err.message)||"error")+"). Try again."; }\n'
      '    return; }\n'
      '  const toSteve=($("#askWho")||{}).value==="steve";')

# 5. A Talk button in the Ask box, and a quicker reading voice.
if not (ROOT / "static/js/askmic.js").exists() or (ROOT / "static/js/askmic.js").read_text() != (Path(__file__).resolve().parent / "askmic.js").read_text():
    shutil.copy2(Path(__file__).resolve().parent / "askmic.js", ROOT / "static/js/askmic.js")
    done.append("static/js/askmic.js: copied")
patch("static/index.html", 'src="js/askmic.js"', '<script src="js/alice.js"></script>', '<script src="js/alice.js"></script>\n<script src="js/askmic.js"></script>')
patch("static/js/core.js", "u.rate=1.2;", "u.rate=0.95;", "u.rate=1.2;")

for title, rows in (("changed", done), ("already there", skipped), ("NOT FOUND", missing)):
    for r in rows:
        print(f"{title}: {r}")
sys.exit(1 if missing else 0)
