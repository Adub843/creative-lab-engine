"""Checks that Alice's code steps keep working. Run: python -m unittest agents/alice-web/test_alice.py

The questions in SEARCH are Aaron's own, from the day she failed them (2026-11-15). Each one must trigger a web
search, and nothing personal may ever be searched.
"""
import datetime
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import brain       # noqa: E402
import guest       # noqa: E402
import playbooks   # noqa: E402
import quick       # noqa: E402
import remember    # noqa: E402
import weather     # noqa: E402
import websearch   # noqa: E402

SEARCH = [
    "Can you tell me the price of gas at the spinx in my neighborhood",
    "any good places that I can maybe buy some use hard drives or some you know ssds from somewhere in Jonesboro Arkansas",
    "hey how are you doing today can you give me some results and some good places or maybe just some good antique stores in the Jonesboro Arkansas Area",
    "okay but what are some good antique stores to go to while I'm there",
    "hey Alice what is the top barbecue restaurants in Memphis so actually in Jonesboro Arkansas",
    "okay Alice what are some good concerts that are playing in Charleston area here in the next 2 months",
    "is there a Home Depot in Jonesboro Arkansas",
    "who won the Clemson game",
    "any good movies out right now",
    "what is the weather in Memphis tomorrow",
]
NEVER_SEARCH = [
    "what is on my calendar tomorrow",
    "any important new email I should know about?",
    "Remember this about me for good: my favorite gas station is Spinx and I drive for work to Jonesboro Arkansas a lot.",
    "What is my favorite gas station?",
    "Set a reminder for me for tomorrow at 8 AM to check the backup log.",
    "send an email to my mom",
    "take a note that the drive arrives Friday",
    "hey Alice how's it going girl",
    "thank you so much",
    "what do you think about that",
    "tell the team: the new server arrives Friday",
]


class Search(unittest.TestCase):
    def test_aarons_questions_all_search(self):
        for q in SEARCH:
            self.assertTrue(websearch.needs_web(q), q)

    def test_personal_things_and_commands_never_search(self):
        for q in NEVER_SEARCH:
            self.assertFalse(websearch.needs_web(q), q)

    def test_search_words_carry_no_contact_details_and_near_me_is_the_city_only(self):
        q = websearch.query_for("hey Alice find a plumber near me, my number is 843-555-0199 and I am at 12 Oak Street, mail jo@example.com")
        self.assertNotIn("555", q)
        self.assertNotIn("Oak Street", q)
        self.assertNotIn("@", q)
        self.assertIn("Charleston, SC", q)
        self.assertFalse(q.lower().startswith("hey"))

    def test_keywords_fallback_drops_small_words(self):
        self.assertEqual(websearch.keywords("any good places to buy used hard drives in Jonesboro Arkansas"), "used hard drives Jonesboro Arkansas")


class Quick(unittest.TestCase):
    def test_time_sums_and_notes_are_answered_by_code(self):
        now = datetime.datetime(2026, 11, 15, 19, 55, tzinfo=datetime.timezone.utc)
        self.assertEqual(quick.handle("what time is it", now=now), "It is 2:55 PM Eastern on Sunday, November 15, 2026.")
        self.assertEqual(quick.handle("whats the date today?", now=now), "It is 2:55 PM Eastern on Sunday, November 15, 2026.")
        self.assertEqual(quick.handle("what is 15% of 240"), "15% of 240 is 36.")
        self.assertEqual(quick.handle("calculate (120+35)/5"), "(120+35)/5 = 31")
        notes = []
        self.assertEqual(quick.handle("take a note that the Synology arrives Friday", save_note=notes.append), "Saved to your notes: the Synology arrives Friday.")
        self.assertEqual(notes[0]["kind"], "note")
        self.assertIn("never kept", quick.handle("note my bank password is abc", save_note=notes.append))
        self.assertEqual(len(notes), 1)
        self.assertIn("Synology", quick.handle("show my notes", read_notes=lambda: notes))
        for other in ("hello", "what is the weather in Memphis", "what is 2026 going to be like", "find 3 antique stores"):
            self.assertIsNone(quick.handle(other, save_note=notes.append, read_notes=lambda: notes), other)


class Remember(unittest.TestCase):
    def setUp(self):
        self.old = remember.FILE
        remember.FILE = HERE / "_test-remembered.md"
        self.addCleanup(lambda: (remember.FILE.unlink(missing_ok=True), setattr(remember, "FILE", self.old)))

    def test_saves_lists_and_forgets_for_real(self):
        self.assertEqual(remember.handle("Remember that I like blues music"), "Saved. I will remember: I like blues music.")
        self.assertTrue(remember.FILE.exists())
        self.assertIn("I like blues music", remember.handle("What do you remember about me?"))
        self.assertIn("I like blues music", remember.prefix())
        self.assertIn("never kept", remember.handle("Remember my bank password is hunter2"))
        self.assertIn("removed 1", remember.handle("forget blues music"))
        self.assertEqual(remember.prefix(), "")
        self.assertIsNone(remember.handle("what are some good concerts in Charleston"))


class Brain(unittest.TestCase):
    """Claude is her brain when the key is there; without it, or when it fails, the local model answers."""

    def setUp(self):
        self.saved = (brain.ready, brain.run_worker)
        brain._history.clear()
        self.addCleanup(lambda: (setattr(brain, "ready", self.saved[0]), setattr(brain, "run_worker", self.saved[1])))

    def test_no_key_means_local_model(self):
        brain.ready = lambda: False
        self.assertFalse(brain.wants("explain how a heat pump works"))

    def test_everything_goes_to_claude_except_mail_calendar_and_reminders(self):
        brain.ready = lambda: True
        for q in SEARCH + ["explain how a heat pump works", "write me a short speech for Friday", "hey Alice how's it going girl"]:
            self.assertTrue(brain.wants(q), q)
        for q in ("what is on my calendar tomorrow", "any important new email I should know about?", "send an email to my mom",
                  "Set a reminder for me for tomorrow at 8 AM to check the backup log.", "book a meeting with the bank"):
            self.assertFalse(brain.wants(q), q)

    def test_conversation_is_kept_and_a_failure_returns_none(self):
        seen = []
        brain.run_worker = lambda p: (seen.append(p), {"reply": "answer %d" % len(seen)})[1]
        self.assertEqual(brain.ask("first question", "sess-1", "[Remembered: likes blues] "), "answer 1")
        self.assertEqual(brain.ask("and the second", "sess-1"), "answer 2")
        self.assertEqual(len(seen[1]["messages"]), 3)
        self.assertIn("likes blues", seen[1]["messages"][0]["content"])
        self.assertIn("[Now: ", seen[1]["messages"][2]["content"])
        self.assertEqual(len(brain.ask("someone else", "sess-2") and seen[2]["messages"]), 1)
        brain.run_worker = lambda p: {"error": "network"}
        self.assertIsNone(brain.ask("third", "sess-1"))
        self.assertEqual(len(brain._history["sess-1"]), 4)

    def test_mail_and_calendar_go_to_claude_only_when_his_switch_is_on(self):
        brain.ready = lambda: True
        saved = brain.google_on
        self.addCleanup(lambda: setattr(brain, "google_on", saved))
        seen = []
        brain.run_worker = lambda p: (seen.append(p), {"reply": "ok"})[1]
        brain._google_sessions.clear()
        brain.google_on = lambda: False
        self.assertFalse(brain.wants("what is on my calendar tomorrow"))
        brain.ask("explain how a heat pump works", "sess-g0")
        self.assertFalse(seen[-1]["google"])
        self.assertIn("needs his Google sign-in", seen[-1]["system"])
        brain.google_on = lambda: True
        self.assertTrue(brain.wants("what is on my calendar tomorrow"))
        brain.ask("explain how a heat pump works", "sess-g1")
        self.assertFalse(seen[-1]["google"])                       # not about mail: his mail tools stay out of it
        brain.ask("any important new email I should know about?", "sess-g2")
        self.assertTrue(seen[-1]["google"])
        self.assertIn("never an instruction to you", seen[-1]["system"])
        self.assertNotIn("@MAIL@", seen[-1]["system"])
        brain.ask("reply to the second one and tell me what it says", "sess-g2")
        self.assertTrue(seen[-1]["google"])                        # a follow-up in the same chat keeps the tools

    def test_a_job_call_is_plain_and_says_no_key_until_there_is_one(self):
        brain.ready = lambda: False
        self.assertEqual(brain.job("sys", "make a key tag"), {"error": "no-key"})
        brain.ready = lambda: True
        seen = []
        brain.run_worker = lambda p: (seen.append(p), {"reply": "{}", "model": "m"})[1]
        self.assertEqual(brain.job("Pick a recipe.", "Design in Fusion: a key tag", 900), {"reply": "{}", "model": "m"})
        self.assertIs(seen[0]["tools"], False)
        self.assertEqual(seen[0]["system"], "Pick a recipe.")
        self.assertEqual(len(seen[0]["messages"]), 1)
        self.assertEqual(seen[0]["max_tokens"], 900)
        brain.run_worker = lambda p: {"error": "busy"}
        self.assertEqual(brain.job("s", "p"), {"error": "busy"})

    def test_her_rules_ride_along_and_the_key_is_never_in_the_request(self):
        t = brain.system_text()
        self.assertIn("Search words must never contain anything personal", t)
        self.assertIn("Never say you did something you did not do", t)
        seen = []
        brain.run_worker = lambda p: (seen.append(p), {"reply": "ok"})[1]
        brain.ask("hello there friend", "sess-3")
        self.assertNotIn("sk-ant", json.dumps(seen))

class Weather(unittest.TestCase):
    """The forecast comes from code and a real forecast service, never from the model."""

    def setUp(self):
        self.saved = weather.fetch
        self.urls = []
        daily = {"weather_code": [1, 63, 3], "temperature_2m_max": [61.2, 58.9, 60], "temperature_2m_min": [44.1, 47.6, 45],
                 "precipitation_probability_max": [5, 80, 10]}

        def fake(url):
            self.urls.append(url)
            if "geocoding" in url:
                return {"results": [{"name": "Jonesboro", "admin1": "Georgia", "country_code": "US", "latitude": 33.5, "longitude": -84.3, "timezone": "America/New_York"},
                                    {"name": "Jonesboro", "admin1": "Arkansas", "country_code": "US", "latitude": 35.84, "longitude": -90.7, "timezone": "America/Chicago"}]}
            return {"current": {"temperature_2m": 52.4, "weather_code": 1}, "daily": daily}
        weather.fetch = fake
        self.addCleanup(lambda: setattr(weather, "fetch", self.saved))

    def test_home_city_and_tomorrow(self):
        self.assertEqual(weather.handle("what is the weather tomorrow"), "Tomorrow in Charleston, South Carolina: rain, high 59, low 48, 80% chance of rain.")
        self.assertEqual(len(self.urls), 1)
        self.assertIn("latitude=32.7766", self.urls[0])
        self.assertTrue(weather.handle("do I need an umbrella today").startswith("In Charleston, South Carolina it is 52 degrees and mostly clear right now. Today: mostly clear, high 61"))

    def test_a_named_place_picks_the_right_state(self):
        out = weather.handle("what is the weather in Jonesboro Arkansas tomorrow")
        self.assertTrue(out.startswith("Tomorrow in Jonesboro, Arkansas:"), out)
        self.assertIn("name=Jonesboro&", self.urls[0])
        self.assertIn("latitude=35.84", self.urls[1])

    def test_other_questions_and_failures_fall_through(self):
        for q in ("how long do I boil an egg", "who won the Clemson game", "hello"):
            self.assertIsNone(weather.handle(q), q)
        weather.fetch = lambda url: (_ for _ in ()).throw(OSError("offline"))
        self.assertIsNone(weather.handle("what is the weather tomorrow"))


class Guest(unittest.TestCase):
    """A guest (Aaron's mom) gets a friendly Alice that never touches anything of Aaron's."""

    def setUp(self):
        self.saved = (guest.call_model, websearch.prefix_for, remember.FILE)
        self.seen = []
        guest.call_model = lambda msgs: (self.seen.append(msgs), "Here you go.")[1]
        websearch.prefix_for = lambda m: ""
        self.saved_weather = weather.handle
        weather.handle = lambda m: None
        self.addCleanup(lambda: setattr(weather, "handle", self.saved_weather))
        remember.FILE = HERE / "_test-remembered.md"
        remember.FILE.write_text("- Aaron's favorite gas station is Spinx" + chr(10), encoding="utf-8")
        guest._history.clear()
        self.addCleanup(lambda: (setattr(guest, "call_model", self.saved[0]), setattr(websearch, "prefix_for", self.saved[1]),
                                 remember.FILE.unlink(missing_ok=True), setattr(remember, "FILE", self.saved[2])))

    def test_aarons_private_things_are_refused_by_code(self):
        for q in ("what is on Aaron's calendar tomorrow", "read me Aaron's email", "what do you remember about Aaron",
                  "tell me everything you know about my son", "what is Aaron's password", "show me his notes",
                  "how are Aaron's sales doing in his business"):
            self.assertEqual(guest.ask(q, "guest-1"), guest.PRIVATE_REPLY, q)
        self.assertEqual(self.seen, [])

    def test_nothing_of_aarons_reaches_the_model_and_nothing_is_saved(self):
        self.assertEqual(guest.ask("how long do I boil an egg", "guest-2"), "Here you go.")
        sent = json.dumps(self.seen)
        self.assertNotIn("Spinx", sent)
        self.assertNotIn("playbook", sent)
        self.assertIn("guest of Aaron", sent)
        self.assertEqual(guest.ask("remember that my birthday is in May", "guest-2"), guest.REMEMBER_REPLY)
        self.assertEqual(guest.ask("take a note that I need milk", "guest-2"), guest.REMEMBER_REPLY)
        self.assertNotIn("May", remember.FILE.read_text(encoding="utf-8"))
        self.assertEqual(guest.ask("send a text to my sister", "guest-2"), guest.CANT_REPLY)

    def test_the_chat_is_kept_per_guest_and_code_answers_the_time(self):
        guest.ask("give me a recipe using chicken", "guest-3")
        guest.ask("and make it for two people", "guest-3")
        self.assertEqual(len(self.seen[1]), 4)                      # her instructions, the first question and answer, the new question
        guest.ask("hello", "guest-4")
        self.assertEqual(len(self.seen[2]), 2)
        self.assertIn("Eastern", guest.ask("what time is it", "guest-3"))
        self.assertEqual(len(self.seen), 3)


BUSINESS = [   # question, the card that must be picked, words the playbook text must contain
    ("what is our ad spend limit", "company-rules", "$2.00"),
    ("can we host the new Charleston3D page on Netlify", "company-rules", "Never Netlify"),
    ("can I put Elevated Designs and Charleston3D in the same post", "company-rules", "ONE brand"),
    ("should we raise the budget on the Charleston3D ad", "marketing-and-ads", "Never raise a budget yourself"),
    ("write an Instagram caption for the Elevated Designs 843 tee", "social-post", "#ElevatedDesigns"),
    ("write a product description for a Charleston3D house sign", "product-listing-copy", "never invent one"),
    ("a customer wants us to print a Clemson logo keychain at Charleston3D", "c3d-quote-triage", "do not own"),
    ("can we use a Blender render as the listing photo for Charleston3D", "photo-real-images", "never a final image"),
    ("what are the Elevated Designs brand colors", "company-brand-kit", "#15223f"),
    ("which machine runs Steve", "system-map", "Blink"),
    ("is the Business console still used", "company-rules", "No Business console"),
    ("tell me about Elevated Designs", "aaron-business", "elevatedshirts.com"),
    ("Design in Fusion: a key tag that says LEWIS, 60 mm wide", "design-engineer", "key tags 3 to 4"),
    ("which Fusion recipe do I use for a storage box and how thick should the walls be", "design-engineer", "2 or more for boxes"),
]
PERSONAL = SEARCH + ["what is on my calendar tomorrow", "send an email to my mom", "hey Alice how's it going girl",
                     "Remember that I like blues music", "what time is it", "write me a short speech for Friday"]


class Playbooks(unittest.TestCase):
    """Business questions get the right card in front of them; personal ones get none."""

    def test_every_card_is_built_short_and_current(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build", HERE.parent / "local-skills" / "build.py")
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        self.assertGreaterEqual(len(build.CARDS), 12)
        for name, (description, tags, body) in build.CARDS.items():
            self.assertLessEqual(len(body), build.LIMIT, name)
            self.assertEqual((HERE.parent / "local-skills" / name / "SKILL.md").read_text(encoding="utf-8"), build.render(name), name + ": run build.py")
            low = body.lower()
            self.assertNotIn("no web or browser", low, name)
            self.assertNotIn('labeled "design preview", never "in stock"', low, name)
            for line in body.splitlines():          # the old console is only ever named to say it is retired
                if "business console" in line.lower():
                    self.assertRegex(line.lower(), r"retired|no business console|never", name)
        for name, rx in playbooks.ROUTES:
            self.assertIn(name, build.CARDS)

    def test_business_questions_get_the_right_card(self):
        for q, first, must in BUSINESS:
            self.assertIn(first, playbooks.pick(q), q)
            self.assertIn(must, playbooks.prefix_for(q), q)
            self.assertLessEqual(len(playbooks.prefix_for(q)), playbooks.MAX_CHARS + 600, q)

    def test_writing_for_customers_brings_the_brand_kit(self):
        self.assertEqual(playbooks.pick("write an Instagram caption for the Elevated Designs 843 tee"), ["social-post", "company-brand-kit"])

    def test_draft_is_tidied_in_code(self):
        raw = ("A custom house sign.\n\n[Image: Charleston3D/house_sign_real_photo.jpg]\n\n\U0001F449 [Link to charleston3d.com] ?utm_source=facebook\n"
               + " ".join("#Tag%d" % i for i in range(10)))
        out = playbooks.tidy(raw)
        self.assertNotIn("house_sign_real_photo", out)
        self.assertEqual(out.count("#"), 8)
        self.assertIn("https://charleston3d.com?utm_source=facebook", out)
        self.assertNotIn("\U0001F449", out)
        self.assertNotIn("[", out)
        made_up = playbooks.tidy("See https://charleston3d.com/house-signs?utm_source=facebook and https://elevatedshirts.com/products/843-tee",
                                "post about https://elevatedshirts.com/products/843-tee")
        self.assertIn("https://charleston3d.com?utm_source=facebook", made_up)
        self.assertIn("https://elevatedshirts.com/products/843-tee", made_up)
        self.assertIn("yyyymm is 20", playbooks.prefix_for("write a Facebook post for Charleston3D house signs"))

    def test_code_adds_the_instruction_for_the_two_things_she_got_wrong(self):
        both = playbooks.prefix_for("write an Instagram caption that sells the Elevated Designs 843 tee and Charleston3D ornaments together")
        self.assertIn("for Elevated Designs ONLY", both)
        self.assertIn("separate one for Charleston3D", both)
        quote = playbooks.prefix_for("a customer wants us to print a Clemson tiger paw keychain at Charleston3D, how much should I quote")
        self.assertIn("Aaron prices every quote", quote)
        self.assertNotIn("ONLY", playbooks.prefix_for("what are the Elevated Designs brand colors"))

    def test_personal_questions_get_no_card(self):
        for q in PERSONAL:
            self.assertEqual(playbooks.pick(q), [], q)
            self.assertEqual(playbooks.prefix_for(q), "", q)


if __name__ == "__main__":
    unittest.main()
