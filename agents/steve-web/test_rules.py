"""Tests for Steve's rule checker, his price notes and the checked turn. No network, no model.

    python -m unittest agents/steve-web/test_rules.py     (from the repo root)
"""
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import prices            # noqa: E402
import rules_check as R  # noqa: E402
import server            # noqa: E402

PRICES = {16.99, 24.99, 12.0}


def rules(reply, asked="", allowed=PRICES):
    return " | ".join(R.check(reply, asked, allowed))


class Checker(unittest.TestCase):
    def test_clean_answer_passes(self):
        self.assertEqual(R.check("Custom desk nameplates, printed to order in Charleston, SC. #Charleston3D",
                                 "Draft an Instagram caption for a Charleston3D desk nameplate.", PRICES), [])

    def test_rule3_other_brand_in_a_one_brand_draft(self):
        self.assertIn("Rule 3", rules("Charleston3D nameplates, and check out Elevated Designs shirts too.",
                                      "Write a caption for a Charleston3D nameplate."))

    def test_rule3_combined_piece_is_rejected_but_a_refusal_with_two_pieces_passes(self):
        asked = "Write one post about Charleston3D nameplates and Elevated Designs shirts together."
        self.assertIn("Rule 3", rules("Get a Charleston3D nameplate and an Elevated Designs tee today.", asked))
        self.assertEqual(rules("These two brands stay separate, so here is the Charleston3D post. I can write a "
                               "separate one for Elevated Designs.", asked), "")

    def test_rule3_a_question_may_name_both_brands(self):
        self.assertEqual(rules("Charleston3D and Elevated Designs must always stay separate.",
                               "Which two brands must stay separate?"), "")

    def test_rule10_invented_price(self):
        self.assertIn("$19.99", rules("The nameplate is $19.99.", "How much is the nameplate?"))
        self.assertEqual(rules("The nameplate is $16.99.", "How much is the nameplate?"), "")

    def test_rule10_a_price_aaron_typed_is_allowed(self):
        self.assertEqual(rules("Sale: now $9.50 this week.", "Write a caption for a Charleston3D sale at $9.50."), "")

    def test_rule16_ad_budget_over_the_cap(self):
        self.assertIn("Rule 16", rules("Boost the post with an ad budget of $5 a day.", "How should I advertise?"))
        self.assertNotIn("Rule 16", rules("Keep ad spend at $2 a day.", "How should I advertise?"))

    def test_rule11_phone_and_street(self):
        self.assertIn("phone", rules("Call us at (843) 555-0142."))
        self.assertIn("street", rules("Visit us at 125 King Street in Charleston."))
        self.assertEqual(rules("Made in Charleston, SC."), "")

    def test_rule2_netlify(self):
        self.assertIn("Rule 2", rules("You could host the page on Netlify.", "Where should I host a landing page?"))
        self.assertEqual(rules("Never Netlify. Use GitHub Pages.", "Where should I host a landing page?"), "")

    def test_rule4_other_payment_service(self):
        self.assertIn("Rule 4", rules("Add a PayPal button for faster checkout."))
        self.assertEqual(rules("All payments go through Shopify checkout. No Stripe."), "")

    def test_rule17_placeholders(self):
        self.assertIn("placeholder", rules("Order now: [link to quote]"))
        self.assertIn("placeholder", rules("Hi {{first_name}}, thanks for your order."))
        self.assertEqual(rules("Order now: https://charleston3d.com/products/mini-name-desk-plate"), "")

    def test_rule9_claims_of_done_work(self):
        self.assertIn("Rule 9", rules("I have posted it to Instagram."))
        self.assertIn("Rule 9", rules("I updated the price on the store."))
        self.assertEqual(rules("Here is a draft for you to approve."), "")

    def test_rule8_asking_for_a_secret(self):
        self.assertIn("Rule 8", rules("Please send me your Shopify password so I can log in."))
        self.assertEqual(rules("Never share a password or key with me."), "")

    def test_rule1_made_up_links(self):
        known = {"https://charleston3d.com/products/mini-name-desk-plate"}
        r = lambda reply, asked="": " | ".join(R.check(reply, asked, PRICES, known))
        self.assertIn("not real pages", r("Shop: https://elevatedshirts.com/products/lowcountry-club-26"))
        self.assertIn("not real pages", r("Shop the tee: [elevatedshirts.com/lowcountry-club-26](https://elevatedshirts.com/lowcountry-club-26)"))
        self.assertIn("not real pages", r("See https://bit.ly/abc123 for more."))
        self.assertEqual(r("Order: https://charleston3d.com/products/mini-name-desk-plate?utm_source=instagram"), "")
        self.assertEqual(r("Shop at https://charleston3d.com/ today. #Charleston3D"), "")
        self.assertEqual(r("Here it is: https://example.org/x", "Use this link https://example.org/x in the post"), "")

    def test_rule1_claims_nobody_gave_him(self):
        self.assertIn("claim", rules("Made in Charleston, SC. Ships in 3-5 days."))
        self.assertIn("claim", rules("Free shipping on every order."))
        self.assertIn("claim", rules("Our best-selling tee, with a money-back promise."))
        self.assertEqual(rules("Free shipping this weekend.", "Write an Elevated Designs post: free shipping this weekend."), "")
        self.assertEqual(rules("Printed to order in Charleston, SC."), "")

    def test_rule17_working_notes_in_customer_text(self):
        asked = "Draft a Facebook post for an Elevated Designs tee."
        self.assertIn("working note", rules("New tee. Real photo of the blank with the design blended in (multiply or displacement).", asked))
        self.assertIn("working note", rules("New tee, written per rule 3.", asked))
        self.assertEqual(rules("New tee, printed in Charleston, SC. Ready for Aaron to approve.", asked), "")
        self.assertEqual(rules("Rule 2 says never Netlify.", "What does rule 2 say?"), "")

    def test_a_tool_call_written_as_text_is_not_an_answer(self):
        self.assertIn("tool call", rules("skill_view(company-brand-kit)"))
        self.assertIn("tool call", rules(""))
        self.assertEqual(rules("Printed to order in Charleston, SC (PLA plastic)."), "")

    def test_emoji_are_stripped_not_rejected(self):
        self.assertEqual(R.strip_emoji("\U0001F449 Order now ✅"), "Order now")
        self.assertEqual(R.strip_emoji("Café — open"), "Café — open")


class Prices(unittest.TestCase):
    def setUp(self):
        prices._cache.clear()
        import time
        prices._cache["c3d"] = {"at": time.time(), "items": [
            {"title": "Mini Name Desk Plate", "url": "https://charleston3d.com/products/mini-name-desk-plate", "prices": [16.99]},
            {"title": "Hype Chain", "url": "https://charleston3d.com/products/hype-chain", "prices": [12.0, 24.99]}]}
        prices._cache["ed"] = {"at": time.time(), "items": [
            {"title": "Lowcountry Tee", "url": "https://elevatedshirts.com/products/lowcountry-tee", "prices": [24.99]}]}

    def test_price_note_only_for_price_questions(self):
        self.assertEqual(prices.price_note("Write a caption for the desk plate.", ["c3d"]), "")
        note = prices.price_note("How much is the Charleston3D desk plate?", ["c3d"])
        self.assertIn("Mini Name Desk Plate: $16.99", note)
        self.assertNotIn("Lowcountry", note)

    def test_price_note_says_when_nothing_matches(self):
        self.assertIn("no listed product matches", prices.price_note("How much is a dragon statue?", ["c3d"]))

    def test_allowed_prices_are_per_brand(self):
        self.assertEqual(prices.allowed_prices(["ed"]), {24.99})
        self.assertEqual(prices.allowed_prices(["c3d"]), {16.99, 12.0, 24.99})


class CheckedTurn(unittest.TestCase):
    def setUp(self):
        Prices.setUp(self)
        server.LOG = HERE / "_test-checker-log.jsonl"
        server.team_notes.BOARD = HERE / "_test-team-notes.jsonl"
        self.addCleanup(lambda: server.team_notes.BOARD.unlink(missing_ok=True))
        self.addCleanup(lambda: server.LOG.unlink(missing_ok=True))

    def turn(self, answers, asked):
        answers = list(answers)
        seen = []
        out = server.ask_steve(asked, "t", call=lambda m, s: (seen.append(m), answers.pop(0))[1])
        return out, seen

    def test_good_answer_goes_straight_through(self):
        out, seen = self.turn(["The Mini Name Desk Plate is $16.99."], "How much is the Charleston3D desk plate?")
        self.assertEqual((out["blocked"], out["fixed"], len(seen)), (False, False, 1))
        self.assertIn("Mini Name Desk Plate: $16.99", seen[0])

    def test_bad_answer_is_sent_back_once_and_the_fix_is_used(self):
        out, seen = self.turn(["It is $19.99.", "The Mini Name Desk Plate is $16.99."], "How much is the Charleston3D desk plate?")
        self.assertEqual((out["blocked"], out["fixed"]), (False, True))
        self.assertIn("$19.99", seen[1])
        self.assertEqual(out["reply"], "The Mini Name Desk Plate is $16.99.")

    def test_a_price_question_may_only_use_the_prices_it_was_shown(self):
        # $24.99 is a real Charleston3D price, but it belongs to the Hype Chain, not the desk plate.
        out, _ = self.turn(["The desk plate is $24.99.", "The Mini Name Desk Plate is $16.99."], "How much is the Charleston3D desk plate?")
        self.assertTrue(out["fixed"])

    def test_two_bad_answers_are_blocked_with_the_reason(self):
        out, _ = self.turn(["It is $19.99.", "It is $18.00."], "How much is the Charleston3D desk plate?")
        self.assertTrue(out["blocked"])
        self.assertIn("Rule 10", out["reply"])
        self.assertNotIn("$19.99", out["reply"])
        self.assertTrue(server.LOG.exists())


class TeamNotes(unittest.TestCase):
    """The shared board: code writes a note, every agent has it on its very next answer."""

    def setUp(self):
        Prices.setUp(self)
        self.T = server.team_notes
        self.T.BOARD = HERE / "_test-team-notes.jsonl"
        self.T.BOARD.unlink(missing_ok=True)
        server.LOG = HERE / "_test-checker-log.jsonl"
        self.addCleanup(lambda: (self.T.BOARD.unlink(missing_ok=True), server.LOG.unlink(missing_ok=True)))

    def test_a_note_is_on_the_board_at_once_and_repeats_are_dropped(self):
        self.assertIsNotNone(self.T.add("aaron", "Nameplates are 10 percent off this week.", by="aaron"))
        self.assertIsNone(self.T.add("aaron", "Nameplates are 10 percent off this week.", by="aaron"))
        self.assertIn("Nameplates are 10 percent off", self.T.prefix_for("Write a Charleston3D caption"))
        self.assertEqual(self.T.prefix_for("What is the weather like?"), "")           # not a business question
        self.assertIn("Nameplates", self.T.prefix_for("anything", always=True))

    def test_secrets_never_go_on_the_board(self):
        for text in ("The Shopify password is hunter2", "api key sk-123", "card 4111 1111 1111 1111"):
            self.assertIsNone(self.T.add("aaron", text))
        self.assertEqual(self.T.read(), [])

    def test_tell_the_team_is_understood(self):
        self.assertEqual(self.T.told("Tell the team: no more Rainbow Row designs."), "no more Rainbow Row designs.")
        self.assertEqual(self.T.told("Hey Steve, let everyone know that the market is Saturday"), "the market is Saturday")
        self.assertIsNone(self.T.told("Tell me about the team page."))
        self.assertIsNone(self.T.told("Write a caption for the team"))

    def test_steve_posts_aarons_note_and_does_not_ask_the_model(self):
        calls = []
        out = server.ask_steve("Tell the team: the Saturday market is cancelled.", "t", call=lambda m, s: calls.append(m) or "x")
        self.assertEqual(calls, [])
        self.assertIn("Posted to the team board", out["reply"])
        self.assertEqual(self.T.read()[-1]["text"], "the Saturday market is cancelled.")

    def test_a_rejected_answer_becomes_a_lesson_the_next_question_sees(self):
        answers = ["It is $19.99.", "The Mini Name Desk Plate is $16.99.", "Sure."]
        seen = []
        ask = lambda q: server.ask_steve(q, "t", call=lambda m, s: (seen.append(m), answers.pop(0))[1])
        ask("How much is the Charleston3D desk plate?")
        self.assertEqual(self.T.read()[-1]["kind"], "lesson")
        ask("Write a Charleston3D caption for the desk plate.")
        self.assertIn("[Team notes", seen[-1])
        self.assertIn("not on the live store", seen[-1])


class PriceByVoice(unittest.TestCase):
    """"Change the price of X to $Y": found in the live list, confirmed out loud, then changed. No model involved."""

    def setUp(self):
        Prices.setUp(self)
        import price_change
        self.P = price_change
        self.P.PENDING.clear()
        self.P.LOG = HERE / "_test-price-changes.jsonl"
        self.addCleanup(lambda: self.P.LOG.unlink(missing_ok=True))
        for store in ("c3d", "ed"):
            for n, item in enumerate(server.prices._cache[store]["items"], 1):
                item["id"] = 100 * (1 if store == "c3d" else 2) + n
        self.posts, self.notes, self.clock = [], [], [1000.0]

    def say(self, text, key="a-console-key-of-16+", fail=None):
        def post(store, pid, price, k):
            if fail:
                raise ValueError(fail)
            self.posts.append((store, pid, price, k))
            return {"changed": 1}
        return self.P.handle(text, "s1", now=lambda: self.clock[0], post=post, key=lambda: key, note=lambda k, t: self.notes.append((k, t)))

    def test_understands_the_sentence_and_ignores_others(self):
        self.assertEqual(self.P.parse("Change the price of the mini name desk plate to 21 dollars"), ("mini name desk plate", 21.0))
        self.assertEqual(self.P.parse("set the price for Lowcountry Tee to $26.50."), ("Lowcountry Tee", 26.5))
        for text in ("What is the price of the desk plate?", "Write a caption about our prices", "change the caption to shorter"):
            self.assertIsNone(self.P.parse(text))
            self.assertIsNone(self.say(text))

    def test_asks_first_and_changes_only_after_yes(self):
        ask = self.say("Change the price of the Charleston3D mini name desk plate to 21 dollars")
        self.assertIn("from $16.99 to $21.00", ask)
        self.assertIn("yes, change it", ask)
        self.assertEqual(self.posts, [])
        done = self.say("Yes, change it")
        self.assertEqual(self.posts, [("c3d", 101, 21.0, "a-console-key-of-16+")])
        self.assertIn("is now $21.00 (was $16.99)", done)
        self.assertEqual(self.notes[0][0], "price")
        self.assertTrue(self.P.LOG.exists())
        self.assertIsNone(self.say("yes, change it"), "a second yes does nothing: nothing is waiting")

    def test_cancel_another_topic_or_waiting_too_long_changes_nothing(self):
        self.say("change the price of the mini name desk plate to 21")
        self.assertIn("Cancelled", self.say("cancel"))
        self.say("change the price of the mini name desk plate to 21")
        self.assertIsNone(self.say("what is rule 2?"))
        self.assertIsNone(self.say("yes, change it"))
        self.say("change the price of the mini name desk plate to 21")
        self.clock[0] += 121
        self.assertIsNone(self.say("yes, change it"))
        self.assertEqual(self.posts, [])

    def test_refuses_what_it_cannot_safely_change(self):
        self.assertIn("could not find", self.say("change the price of the dragon statue to 30"))
        self.assertIn("different prices by size", self.say("change the price of the hype chain to 15"))
        self.assertIn("already $16.99", self.say("change the price of the mini name desk plate to 16.99"))
        self.assertIn("from $0.50 to $5,000.00", self.say("change the price of the mini name desk plate to 0.10"))
        self.assertIn("console key has not been set", self.say("change the price of the mini name desk plate to 21", key=None))
        self.assertEqual(self.P.PENDING, {})
        self.assertEqual(self.posts, [])

    def test_the_engines_refusal_is_repeated_and_nothing_is_logged(self):
        self.say("change the price of the Elevated Designs lowcountry tee to 30")
        out = self.say("yes", fail="This shirt is priced from the price sheet, and the sync would put the sheet's price back.")
        self.assertIn("did not change", out)
        self.assertIn("price sheet", out)
        self.assertEqual(self.notes, [])
        self.assertFalse(self.P.LOG.exists())

    def test_steve_answers_a_price_change_without_the_model(self):
        self.P.read_key = lambda: None
        calls = []
        out = server.ask_steve("Change the price of the mini name desk plate to 21", "s9", call=lambda m, s: calls.append(m) or "x")
        self.assertEqual(calls, [])
        self.assertIn("console key has not been set", out["reply"])


class Learning(unittest.TestCase):
    ROWS = [{"asked": "Draft a Facebook post for an Elevated Designs tee.", "at": "2026-11-15T07:00:00-05:00",
             "first_problems": ["Rule 1: these links are not real pages on the store: elevatedshirts.com/x. Use a real link."]},
            {"asked": "Draft a Facebook post for an Elevated Designs tee.", "at": "2026-11-15T08:00:00-05:00",
             "first_problems": ["Rule 1: these links are not real pages on the store: elevatedshirts.com/y. Use a real link.",
                                "That was a tool call or an empty answer, not an answer."]}]

    def test_one_lesson_per_kind_of_mistake(self):
        import learn
        fresh = learn.lessons_from_log(self.ROWS)
        self.assertEqual(len(fresh), 1)
        self.assertIn("you broke rule 1", fresh[0]["text"])
        self.assertEqual(learn.lessons_from_log(self.ROWS, fresh), [])

    def test_render_adds_and_replaces_the_lessons_section(self):
        import learn
        base = (HERE / "SOUL.md").read_text(encoding="utf-8")
        lessons = learn.lessons_from_log(self.ROWS)
        once = learn.render(base, lessons)
        self.assertIn(learn.HEADING, once)
        self.assertEqual(learn.render(once, lessons), once)
        self.assertEqual(learn.render(once, []), learn.render(base, []))
        self.assertEqual([int(n) for n in re.findall(r"(?m)^(\d+)\. ", once)], list(range(1, 21)))

    def test_lessons_are_kept_only_when_nothing_got_worse(self):
        import learn
        self.assertTrue(learn.keep([22, 21, 17], [22, 21, 17], 22, 22))
        self.assertTrue(learn.keep([23, 23, 18], [22, 21, 17], 23, 22))     # one more question, all pass
        self.assertFalse(learn.keep([21, 21, 17], [22, 21, 17], 22, 22))    # a new failure
        self.assertFalse(learn.keep([22, 20, 17], [22, 21, 17], 22, 22))    # a new block
        self.assertFalse(learn.keep([21, 21, 20], None, 22, 0))             # first run must pass everything
        self.assertTrue(learn.keep([22, 21, 16], None, 22, 0))

    def test_score_reads_the_trick_results(self):
        import learn
        rows = [{"ok": True, "blocked": False, "fixed": False}, {"ok": True, "blocked": True, "fixed": False},
                {"ok": True, "blocked": False, "fixed": True}, {"ok": False, "blocked": False, "fixed": False}]
        self.assertEqual(learn.score({"rows": rows}), [3, 3, 1])


class RulesStayInStep(unittest.TestCase):
    """Steve's instructions carry the same numbered hard rules as the repo's CLAUDE.md master list."""

    def test_soul_has_rules_1_to_20_and_the_name(self):
        soul = (HERE / "SOUL.md").read_text(encoding="utf-8")
        self.assertEqual([int(n) for n in re.findall(r"(?m)^(\d+)\. ", soul)], list(range(1, 21)))
        self.assertIn("You are Steve", soul)
        self.assertNotIn("Alice", soul)
        for must in ("Never Netlify", "Shopify checkout", "Never invent prices", "$2.00", "Charleston, SC"):
            self.assertIn(must, soul)


if __name__ == "__main__":
    unittest.main()
