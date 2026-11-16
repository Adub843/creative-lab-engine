// Sign-in for the Lab: passkeys (face, fingerprint or device PIN), long-lived sessions per device,
// one-time setup codes typed at the server, and narrow keys for agents (Stacy's runner, Alice).
// Nothing secret is ever sent to the page: sessions are HTTP-only cookies, keys are stored hashed.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const DAY = 864e5;
export const SESSION_DAYS = 30;
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const token = (n = 32) => randomBytes(n).toString("base64url");

export class Auth {
  constructor(file, { rpID, origin, people }) {
    this.rpID = rpID; this.origin = origin;
    this.sql = new DatabaseSync(file);
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, name TEXT NOT NULL, level TEXT NOT NULL, color TEXT);
      CREATE TABLE IF NOT EXISTS passkeys(cred TEXT PRIMARY KEY, person TEXT NOT NULL, pubkey BLOB NOT NULL, counter INTEGER NOT NULL,
        transports TEXT, device TEXT, created INTEGER NOT NULL, last_used INTEGER);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, person TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
        device TEXT, last_seen INTEGER);
      CREATE TABLE IF NOT EXISTS setup_codes(hash TEXT PRIMARY KEY, person TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_keys(hash TEXT PRIMARY KEY, name TEXT NOT NULL, person TEXT NOT NULL, scopes TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER);
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, challenge TEXT NOT NULL, person TEXT, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS signins(at INTEGER NOT NULL, person TEXT, kind TEXT NOT NULL, device TEXT, ip TEXT);`);
    const up = this.sql.prepare("INSERT INTO people(id,name,level,color) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, level=excluded.level, color=excluded.color");
    for (const p of people || []) up.run(p.id, p.name, p.level || "interact", p.color || null);
  }
  close() { this.sql.close(); }

  people() { return this.sql.prepare("SELECT id,name,level,color FROM people ORDER BY rowid").all(); }
  person(id) { return this.sql.prepare("SELECT id,name,level,color FROM people WHERE id=?").get(id) || null; }
  log(person, kind, device, ip) { this.sql.prepare("INSERT INTO signins VALUES(?,?,?,?,?)").run(Date.now(), person || null, kind, device || null, ip || null); }
  recentSignins(n = 200) { return this.sql.prepare("SELECT * FROM signins ORDER BY at DESC LIMIT ?").all(n); }

  /* ---- setup codes: typed at the server's keyboard, good for 30 minutes, one use ---- */
  newSetupCode(personId) {
    if (!this.person(personId)) throw new Error(`no person with id ${personId}`);
    const code = randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-");
    this.sql.prepare("INSERT INTO setup_codes VALUES(?,?,?)").run(sha(code.replace(/-/g, "")), personId, Date.now() + 30 * 60e3);
    return code;
  }
  useSetupCode(code) {
    const h = sha(String(code || "").toUpperCase().replace(/[^0-9A-F]/g, ""));
    const row = this.sql.prepare("SELECT person, expires FROM setup_codes WHERE hash=?").get(h);
    if (!row || row.expires < Date.now()) return null;
    this.sql.prepare("DELETE FROM setup_codes WHERE hash=?").run(h);
    return row.person;
  }

  /* ---- sessions ---- */
  newSession(personId, device) {
    const t = token();
    this.sql.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(sha(t), personId, Date.now(), Date.now() + SESSION_DAYS * DAY, device || null, Date.now());
    return t;
  }
  session(t) {
    if (!t) return null;
    const row = this.sql.prepare("SELECT person, expires, last_seen FROM sessions WHERE hash=?").get(sha(t));
    if (!row || row.expires < Date.now()) return null;
    if (Date.now() - (row.last_seen || 0) > 3600e3) // slide the expiry at most once an hour
      this.sql.prepare("UPDATE sessions SET last_seen=?, expires=? WHERE hash=?").run(Date.now(), Date.now() + SESSION_DAYS * DAY, sha(t));
    return this.person(row.person);
  }
  endSession(t) { if (t) this.sql.prepare("DELETE FROM sessions WHERE hash=?").run(sha(t)); }
  sessions(personId) { return this.sql.prepare("SELECT hash, created, last_seen, device FROM sessions WHERE person=? AND expires>?").all(personId, Date.now()).map(s => ({ ...s, id: s.hash.slice(0, 12), hash: undefined })); }
  endSessionById(personId, shortId) { this.sql.prepare("DELETE FROM sessions WHERE person=? AND substr(hash,1,12)=?").run(personId, shortId); }

  /* ---- agent keys (Stacy's runner, Alice, the engine connector) ---- */
  newAgentKey(name, personId, scopes) {
    const t = "lab_" + token(30);
    this.sql.prepare("INSERT INTO agent_keys VALUES(?,?,?,?,?,NULL)").run(sha(t), name, personId, JSON.stringify(scopes), Date.now());
    return t;
  }
  agent(t) {
    if (!t || !String(t).startsWith("lab_")) return null;
    const row = this.sql.prepare("SELECT name, person, scopes FROM agent_keys WHERE hash=?").get(sha(t));
    if (!row) return null;
    this.sql.prepare("UPDATE agent_keys SET last_used=? WHERE hash=?").run(Date.now(), sha(t));
    const p = this.person(row.person);
    return p && { ...p, agent: row.name, scopes: JSON.parse(row.scopes) };
  }

  /* ---- passkeys ---- */
  saveChallenge(challenge, person) {
    const id = token(16);
    this.sql.prepare("DELETE FROM challenges WHERE expires<?").run(Date.now());
    this.sql.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run(id, challenge, person || null, Date.now() + 5 * 60e3);
    return id;
  }
  takeChallenge(id) {
    const row = this.sql.prepare("SELECT challenge, person, expires FROM challenges WHERE id=?").get(String(id || ""));
    this.sql.prepare("DELETE FROM challenges WHERE id=?").run(String(id || ""));
    return row && row.expires > Date.now() ? row : null;
  }
  async registerOptions(personId) {
    const p = this.person(personId);
    const existing = this.sql.prepare("SELECT cred, transports FROM passkeys WHERE person=?").all(personId);
    const opts = await generateRegistrationOptions({
      rpName: "Lab", rpID: this.rpID, userName: p.name, userDisplayName: p.name,
      userID: new TextEncoder().encode(p.id), attestationType: "none",
      excludeCredentials: existing.map(c => ({ id: c.cred, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    return { options: opts, ticket: this.saveChallenge(opts.challenge, personId) };
  }
  async registerVerify(ticket, response, device) {
    const ch = this.takeChallenge(ticket);
    if (!ch || !ch.person) throw new Error("This sign-up took too long. Start again.");
    const v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true });
    if (!v.verified || !v.registrationInfo) throw new Error("The passkey couldn't be checked.");
    const c = v.registrationInfo.credential;
    this.sql.prepare("INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,NULL)").run(c.id, ch.person, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports || response.response?.transports || []), device || null, Date.now());
    return this.person(ch.person);
  }
  async loginOptions() {
    const opts = await generateAuthenticationOptions({ rpID: this.rpID, userVerification: "required" });
    return { options: opts, ticket: this.saveChallenge(opts.challenge, null) };
  }
  async loginVerify(ticket, response) {
    const ch = this.takeChallenge(ticket);
    if (!ch) throw new Error("This sign-in took too long. Try again.");
    const row = this.sql.prepare("SELECT * FROM passkeys WHERE cred=?").get(String(response && response.id || ""));
    if (!row) throw new Error("This passkey isn't registered with the Lab.");
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true,
      credential: { id: row.cred, publicKey: new Uint8Array(row.pubkey), counter: row.counter, transports: row.transports ? JSON.parse(row.transports) : undefined },
    });
    if (!v.verified) throw new Error("The passkey didn't match.");
    this.sql.prepare("UPDATE passkeys SET counter=?, last_used=? WHERE cred=?").run(v.authenticationInfo.newCounter, Date.now(), row.cred);
    return this.person(row.person);
  }
  passkeys(personId) { return this.sql.prepare("SELECT substr(cred,1,12) AS id, device, created, last_used FROM passkeys WHERE person=?").all(personId); }
}

export function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
