"""Checks that Alice's code steps keep working. Run: python -m unittest agents/alice-web/test_alice.py

The questions in SEARCH are Aaron's own, from the day she failed them (2026-11-15). Each one must trigger a web
search, and nothing personal may ever be searched.
"""
import datetime
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import quick       # noqa: E402
import remember    # noqa: E402
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


if __name__ == "__main__":
    unittest.main()
