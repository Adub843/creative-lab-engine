// Passkey sign-in end to end, with Chromium's virtual authenticator standing in for a face or fingerprint.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { makeServer } from "../server/index.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
let lab, base, browser;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "lablogin-")); mkdirSync(join(dir, "site"));
  writeFileSync(join(dir, "site/index.html"), "<!doctype html><html><head><meta charset=utf8></head><body><h1 id=lab>Lab home</h1></body></html>");
  const cfg = { port: 0, dataDir: join(dir, "data"), labDir: join(dir, "site") };
  lab = makeServer(cfg); await new Promise(r => lab.server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${lab.server.address().port}`; cfg.origin = base; cfg.rpID = "localhost";
  lab.auth.origin = base; lab.auth.rpID = "localhost";
  browser = await chromium.launch();
});
after(async () => { await browser.close(); await new Promise(r => lab.server.close(r)); });

test("set up a device with a code, sign out, sign back in with the passkey", async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });

  await p.goto(base + "/");
  assert.match(p.url(), /\/_lab\/login\?next=%2F$/);
  await p.click("#toSetup");
  await p.fill("#code", "00000-00000"); await p.click("#register");
  await p.waitForFunction(() => document.getElementById("msg").textContent.length > 0);
  assert.match(await p.textContent("#msg"), /setup code/i);

  const code = lab.auth.newSetupCode("aaron");
  await p.fill("#code", code); await p.click("#register");
  await p.waitForURL(base + "/"); assert.equal(await p.textContent("#lab"), "Lab home");
  // the code worked once only
  assert.equal(lab.auth.useSetupCode(code), null);

  await p.evaluate(() => fetch("/_lab/auth/logout", { method: "POST" }));
  await p.goto(base + "/"); assert.match(p.url(), /\/_lab\/login/);
  await p.click("#go");
  await p.waitForURL(base + "/"); assert.equal(await p.textContent("#lab"), "Lab home");
  const me = await p.evaluate(() => fetch("/_lab/auth/me").then(r => r.json()));
  assert.equal(me.person.id, "aaron");
  const log = lab.auth.recentSignins().map(x => x.kind);
  assert.deepEqual(log.slice(0, 2), ["passkey", "passkey-added"]);
  const cookies = await ctx.cookies(); const c = cookies.find(x => x.name === "lab_s");
  assert.equal(c.httpOnly, true); assert.equal(c.sameSite, "Strict");
});

test("the sign-in page at phone size", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await p.goto(base + "/_lab/login");
  const box = await p.locator(".card").boundingBox();
  assert.ok(box.width <= 390 - 32 + 1 && box.x >= 15);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});
