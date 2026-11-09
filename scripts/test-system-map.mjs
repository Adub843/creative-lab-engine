// System map tests (lib/system-map.mjs), with R2 and KV faked. Run: node scripts/test-system-map.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../lib/system-map.mjs";

const KEY = "open-sesame-test-key-0001";
const env = (k) => ({ CONSOLE_KEY: KEY })[k];
function fakeR2() {
  const m = new Map();
  return { m, async put(k, v) { m.set(k, String(v)); }, async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; } };
}
const NOW = Date.parse("2026-11-09T12:00:00Z");
const req = (method = "GET", key = KEY) => ({ method, header: (k) => (k === "x-console-key" ? key : null) });

test("a run is recorded under its job, and only known crons are recorded", async () => {
  const b = fakeR2();
  const rec = await M.recordRun(b, "*/15 * * * *", { ok: true, result: { changed: 2 }, at: NOW });
  assert.equal(rec.job, "cron-price");
  assert.equal(rec.text, "2 prices changed");
  assert.ok(b.m.has("status/cron-cron-price.json"));
  assert.equal(await M.recordRun(b, "5 5 * * *", { ok: true }), null);
  assert.equal(b.m.size, 1);
});

test("a failed run carries a short reason, never the whole result", async () => {
  const b = fakeR2();
  const rec = await M.recordRun(b, "45 * * * *", { ok: false, error: new Error("Kittl said no ".repeat(40)) });
  assert.equal(rec.ok, false);
  assert.ok(rec.text.length <= 160);
});

test("job status: on time, failed, missed and never run", () => {
  const job = M.JOBS.find((j) => j.id === "cron-price");
  assert.equal(M.jobStatus(job, { at: new Date(NOW - 10 * 60e3).toISOString(), ok: true, text: "ran" }, NOW).tone, "ok");
  assert.equal(M.jobStatus(job, { at: new Date(NOW - 10 * 60e3).toISOString(), ok: false, text: "sheet refused" }, NOW).tone, "bad");
  const missed = M.jobStatus(job, { at: new Date(NOW - 3 * 3600e3).toISOString(), ok: true, text: "ran" }, NOW);
  assert.equal(missed.tone, "bad");
  assert.match(missed.text, /missed/);
  assert.equal(M.jobStatus(job, null, NOW).tone, "off");
});

test("the map raises the engine alarm when any job is late, and reads the heartbeat", async () => {
  const b = fakeR2();
  for (const j of M.JOBS) await b.put(M.cronKey(j.id), JSON.stringify({ job: j.id, at: new Date(NOW - 5 * 60e3).toISOString(), ok: true, text: "ran" }));
  await b.put(M.NETWORK_KEY, JSON.stringify({ at: new Date(NOW - 3 * 60e3).toISOString(), host: "nuc-skull", gateway: { up: true, ms: 3 }, edrive: { present: true, freeGB: 1412.6 },
    tailscale: [{ name: "blink", online: true }, { name: "aarons-s23-ultra", online: false, lastSeen: "2026-11-08T05:00:00Z" }], secret: "never passed on" }));
  let out = await M.buildSystemMap({ bucket: b, now: NOW });
  assert.equal(out.nodes.engine.tone, "ok");
  assert.equal(out.nodes.engine.jobs.length, 4);
  assert.equal(out.network.edrive.freeGB, 1413);
  assert.equal(out.network.tailscale[1].online, false);
  assert.equal(out.network.secret, undefined);
  assert.equal(out.network.lost, undefined);
  await b.put(M.cronKey("cron-price"), JSON.stringify({ at: new Date(NOW - 2 * 3600e3).toISOString(), ok: true }));
  out = await M.buildSystemMap({ bucket: b, now: NOW + 20 * 60e3 });
  assert.equal(out.nodes.engine.tone, "bad");
  assert.equal(out.network.lost, true, "no heartbeat for 15 minutes means the PC lost contact");
});

test("kittl circle: synced, missed, never", async () => {
  const kv = (v) => ({ get: async () => v });
  assert.equal((await M.buildSystemMap({ imagesKv: kv({ at: new Date(NOW - 3600e3).toISOString() }), now: NOW })).nodes.kittl.tone, "ok");
  assert.equal((await M.buildSystemMap({ imagesKv: kv({ at: new Date(NOW - 30 * 3600e3).toISOString() }), now: NOW })).nodes.kittl.tone, "bad");
  assert.equal((await M.buildSystemMap({ imagesKv: kv(null), now: NOW })).nodes.kittl.tone, "off");
});

test("a bad heartbeat is ignored, not trusted", () => {
  assert.equal(M.cleanHeartbeat(null), null);
  assert.equal(M.cleanHeartbeat({ at: "yesterday-ish" }), null);
  const h = M.cleanHeartbeat({ at: "2026-11-09T11:58:00Z", tailscale: Array.from({ length: 100 }, (_, i) => ({ name: "d" + i })), lan: "nope" });
  assert.equal(h.tailscale.length, 40);
  assert.deepEqual(h.lan, []);
});

test("the route needs the console key and GET", async () => {
  const b = fakeR2();
  await assert.rejects(() => M.handleSystemMap(req("GET", "wrong-key-wrong-key-1"), { env, bucket: b, now: NOW }), (e) => e.status === 401);
  await assert.rejects(() => M.handleSystemMap(req("POST"), { env, bucket: b, now: NOW }), (e) => e.status === 405);
  const out = await M.handleSystemMap(req(), { env, bucket: b, now: NOW });
  assert.equal(out.nodes.engine.jobs.every((j) => j.tone === "off"), true);
  assert.equal(out.network, null);
});
