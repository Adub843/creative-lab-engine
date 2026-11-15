// Alice's mailbox: how people talk to Alice from inside the Lab console.
//
// Alice is Aaron's own local model on the Blink. The console is a claude.ai page and can't reach the Blink, so a
// question goes through this engine: the console posts it (through the actions queue, like every console call),
// a small runner on Aaron's PC (scripts/alice-mailbox.mjs) picks it up, asks the model already loaded on the Blink,
// and posts the answer back; the console then reads the answer and saves it in its own database.
//
//   POST /api/alice          { person, text, private?, history? }   -> 201 { id }
//   GET  /api/alice?id=<id>                                         -> { status: "waiting" | "answered", answer? }
//                            (once read, the question and the answer are deleted here: the console keeps the copy)
//   GET  /api/alice/next                                            -> { question | null }   (the runner)
//   POST /api/alice/answer   { id, text }                           -> 201 { ok }            (the runner)
//
// Everything is in the RESULTS R2 bucket under alice/, never KV, so it costs none of the free plan's KV writes.
// "private" questions are answered the same way; the console saves them in the asker's own private space, and
// this bucket forgets them as soon as the answer has been read. Every route needs the console key.
import { HttpError, ok, fail, readJsonBody, requireKey } from "./shopify.mjs";

export const Q_PREFIX = "alice/q/";
export const A_PREFIX = "alice/a/";
export const CLAIM_PREFIX = "alice/claim/";
export const MAX_TEXT = 2000;
export const MAX_HISTORY = 8;
export const CLAIM_MS = 5 * 60 * 1000; // a runner that died mid-answer gives the question back after 5 minutes
export const KEEP_MS = 3 * 24 * 60 * 60 * 1000; // unanswered questions are dropped after 3 days
const ID = /^al[a-z0-9]{10,40}$/;
const PERSON = /^[A-Za-z][A-Za-z .'-]{0,30}$/;
const SECRET = /\b(?:shpat_|sk-|ghp_|github_pat_)[A-Za-z0-9_]{6,}/;

const newId = (nowMs) => "al" + nowMs.toString(36) + Math.random().toString(36).slice(2, 12);

function cleanText(v, field, max = MAX_TEXT) {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, "bad_input", `${field} is required.`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, "bad_input", `Keep ${field} under ${max} characters.`);
  if (SECRET.test(t)) throw new HttpError(400, "private_detail", "That looks like it has a key or password in it. Never send keys to Alice.");
  return t;
}
function cleanHistory(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, "bad_input", "history must be a list.");
  return list.slice(-MAX_HISTORY).map((h) => ({
    from: h && h.from === "alice" ? "alice" : "person",
    text: String((h && h.text) || "").slice(0, 1000),
  })).filter((h) => h.text);
}
function cleanId(v) {
  if (!ID.test(String(v ?? ""))) throw new HttpError(400, "bad_input", "id is missing or not an Alice message id.");
  return String(v);
}
async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch { return null; }
}
const putJson = (bucket, key, v) => bucket.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });

// The oldest question nobody is answering right now (or whose runner gave up), dropping ones older than KEEP_MS.
async function nextQuestion(bucket, nowMs) {
  const qs = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: Q_PREFIX, cursor });
    qs.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && qs.length < 1000);
  const stale = qs.filter((o) => nowMs - new Date(o.uploaded).getTime() > KEEP_MS).map((o) => o.key);
  if (stale.length) await bucket.delete(stale);
  const live = qs.filter((o) => !stale.includes(o.key)).sort((a, b) => a.key.localeCompare(b.key));
  for (const o of live) {
    const id = o.key.slice(Q_PREFIX.length, -".json".length);
    if (await bucket.head(A_PREFIX + id + ".json")) continue; // answered, waiting for the console to read it
    const claim = await readJson(bucket, CLAIM_PREFIX + id + ".json");
    if (claim && nowMs - Date.parse(claim.at) < CLAIM_MS) continue;
    const q = await readJson(bucket, o.key);
    if (!q) continue;
    await putJson(bucket, CLAIM_PREFIX + id + ".json", { at: new Date(nowMs).toISOString() });
    return q;
  }
  return null;
}

export async function handleAlice(req, ctx, sub = "", clock = () => new Date()) {
  try {
    const bucket = ctx.bucket;
    if (!bucket) throw new HttpError(503, "storage_not_set_up", "Alice's mailbox isn't set up: the RESULTS R2 bucket binding is missing.");
    requireKey(req, ctx.env, "Alice's mailbox");
    const nowMs = clock().getTime(), now = new Date(nowMs).toISOString();

    if (sub === "next") {
      if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
      return ok({ question: await nextQuestion(bucket, nowMs) });
    }
    if (sub === "answer") {
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
      const body = await readJsonBody(req);
      const id = cleanId(body.id);
      if (!(await bucket.head(Q_PREFIX + id + ".json"))) throw new HttpError(404, "not_found", "That question isn't waiting any more.");
      const text = cleanText(body.text, "text", 6000);
      await putJson(bucket, A_PREFIX + id + ".json", { id, text, at: now });
      await bucket.delete(CLAIM_PREFIX + id + ".json");
      return ok({ ok: true }, 201);
    }
    if (sub) throw new HttpError(404, "not_found", "Unknown Alice route.");

    if (req.method === "GET") {
      const id = cleanId(req.query.get("id"));
      const a = await readJson(bucket, A_PREFIX + id + ".json");
      if (!a) {
        if (!(await bucket.head(Q_PREFIX + id + ".json"))) throw new HttpError(404, "not_found", "Alice doesn't have that question any more. Send it again.");
        return ok({ status: "waiting" });
      }
      await bucket.delete([Q_PREFIX + id + ".json", A_PREFIX + id + ".json", CLAIM_PREFIX + id + ".json"]);
      return ok({ status: "answered", answer: { text: a.text, at: a.at } });
    }
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
    const body = await readJsonBody(req);
    const person = String(body.person ?? "").trim();
    if (!PERSON.test(person)) throw new HttpError(400, "bad_input", "person must be the name of whoever is signed in.");
    const q = { id: newId(nowMs), person, private: body.private === true, text: cleanText(body.text, "text"), history: cleanHistory(body.history), at: now };
    await putJson(bucket, Q_PREFIX + q.id + ".json", q);
    return ok({ id: q.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
