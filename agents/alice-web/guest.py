"""Alice for a guest (Aaron, 2026-11-17: "just make her work for now so my mom can use her tomorrow").

The page at /guest is the same Alice, but a guest never touches anything of Aaron's. This is done in code, not by
asking the model to behave:
- The guest path does not call Hermes at all, so there is no memory, no mail or calendar tool, no file tool and no
  skills. It talks straight to the model with its own short instructions.
- Aaron's saved facts, notes, team board and business playbooks are never put in front of a guest's message.
- A question about Aaron's private things gets a fixed, kind answer from code.
- Nothing a guest says is saved to Aaron's notes or memory. The chat lives only in this process and in her browser.

It is a courtesy wall, not a lock: the device she uses can still open Aaron's own page at "/".
"""
import json
import re
import threading
import urllib.request

import quick
import weather
import websearch

LMSTUDIO = "http://127.0.0.1:1234/v1/chat/completions"
MODEL = "qwen/qwen3-4b-2507"
KEEP = 12                 # messages of the chat that are sent along
TIMEOUT = 180

SYSTEM = """You are Alice, a warm and patient helper on Aaron Lewis's home computer in Charleston, SC.
You are talking with a guest of Aaron's, a family member or a friend. You are not talking with Aaron.

How to answer:
- Plain, friendly words. Short answers: a few sentences, or a short list. No jargon. It may be read out loud.
- If the question is unclear, ask one short, kind question.
- When web results are given in square brackets, answer from them and use only their links, each on its own line.
  Never say you cannot reach the web.
- You can help with: questions about almost anything, recipes and cooking, writing a message, card or letter,
  explaining how something works, ideas for gifts or trips, simple sums, spelling.
- Never make up a fact, a phone number, an address or a link. If you do not know, say so.
- Health, legal or money questions: give general information in plain words and say a doctor, lawyer or advisor
  should confirm it. In an emergency say to call 911.
- You do not have and cannot share anything of Aaron's: his email, calendar, notes, files, passwords or business
  details. If asked, say kindly that those are private to Aaron.
- You cannot send messages, set reminders, make calls or buy anything. If asked, say so and offer to help write it.
- Never say you did something you did not do."""

# Anything aimed at Aaron's own things is answered by code, never by the model.
PRIVATE_RE = re.compile(
    r"\b(aaron'?s?\b[^.?!]{0,60}\b(e-?mails?|inbox|gmail|calendar|schedule|appointments?|meetings?|notes?|files?|passwords?|"
    r"accounts?|bank|money|business|customers?|orders?|sales|texts?|messages?|photos?|address|phone number|secrets?|plans?)|"
    r"(what|anything|everything|tell me|show me)[^.?!]{0,40}\b(know|remember|saved|have)\b[^.?!]{0,30}\b(about|on|for) (aaron|him|my son)|"
    r"(read|show|open|check|search|look (?:at|in|through))[^.?!]{0,30}\b(his|aaron'?s?|the) (e-?mails?|inbox|gmail|calendar|notes?|files?|"
    r"messages?|texts?)|(his|aaron'?s?) (password|passwords|log-?in|pin|bank|social security))\b", re.I)
PRIVATE_REPLY = ("Those are private to Aaron, so I can't look at them or share them. "
                 "I'm happy to help you with something else: a question, a recipe, a letter, or looking something up.")
# Things only Aaron's own Alice does. A guest gets a plain, honest answer.
CANT_RE = re.compile(r"\b(send (?:an? )?(?:e-?mail|text|message)|e-?mail (?:him|her|them|my|aaron)|text (?:him|her|them|my|aaron)|"
                     r"set (?:a|an|my) (?:reminder|alarm|timer)|remind me|add (?:it|this|that)? ?to (?:my|the) calendar|call (?:him|her|my|aaron))\b", re.I)
CANT_REPLY = ("I can't send messages, make calls or set reminders from here. "
              "I can help you write it, and you can send it yourself. What would you like it to say?")
REMEMBER_RE = re.compile(r"^\s*(?:hey |hi |ok |okay |alice[, ]+|please )*(remember|don'?t forget|forget|take a note|note that|save (?:this|that))\b", re.I)
REMEMBER_REPLY = "I don't keep notes for guests, so nothing you tell me here is saved. I'm glad to help with it right now, though."

_history = {}
_lock = threading.Lock()


def call_model(messages):
    """One plain chat call to the local model. No tools, no memory. Replaced in tests."""
    body = {"model": MODEL, "messages": messages, "temperature": 0.4, "max_tokens": 700}
    req = urllib.request.Request(LMSTUDIO, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        text = json.load(r)["choices"][0]["message"]["content"] or ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def ask(message, session):
    """A guest's answer. Uses nothing of Aaron's and saves nothing."""
    m = (message or "").strip()
    if PRIVATE_RE.search(m):
        return PRIVATE_REPLY
    if REMEMBER_RE.match(m):
        return REMEMBER_REPLY
    if CANT_RE.search(m):
        return CANT_REPLY
    try:                                         # the time, the date and sums; no note is ever saved or shown to a guest
        done = None if re.search(r"\bnotes?\b", m, re.I) else quick.handle(m)
    except Exception:
        done = None
    if done is None:
        done = weather.handle(m)             # a real forecast, by code
    if done is not None:
        return done
    try:
        found = websearch.prefix_for(m)
    except Exception:
        found = ""
    with _lock:
        past = list(_history.get(session, []))
    reply = call_model([{"role": "system", "content": SYSTEM}] + past + [{"role": "user", "content": found + m}])
    reply = reply or "I'm sorry, I lost my train of thought. Could you ask me that once more?"
    with _lock:
        h = _history.setdefault(session, [])
        h += [{"role": "user", "content": m}, {"role": "assistant", "content": reply}]
        del h[:-KEEP]
        if len(_history) > 100:
            _history.pop(next(iter(_history)))
    return reply
