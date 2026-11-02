import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/scores.js"; // the Worker reads globalThis.BBScores, as in the deployed bundle
import { handle } from "../worker/scores.js";
import { createHmac } from "node:crypto";

const KEY = "k-test";
// a run ticket made the way the Worker signs them (written here on its own, so a slip on either side shows)
const ticketAt = (t, key = KEY) => t + "." + createHmac("sha256", "bb-ticket:" + key).update("run:" + t).digest("base64url").slice(0, 27);
let made = 0;
const ticket = (base) => ticketAt(base - 1_000_000 - made++); // a fresh ticket from ~17 minutes before base

const ORIGIN = "https://maumoya.github.io";
const T0 = 1_800_000_000_000;

const fakeKV = () => {
  const m = new Map(), ttls = new Map();
  return { m, ttls, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v, o) => { m.set(k, v); ttls.set(k, o && o.expirationTtl); } };
};
const post = (body, headers = {}) => new Request("https://w.test/submit", {
  method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": "1.2.3.4", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const good = (over = {}) => ({ initials: "ace", score: 1200, wave: 3, seconds: 90, ticket: ticket(T0), ...over });
const topOf = async (env) => (await (await handle(new Request("https://w.test/top", { headers: { Origin: ORIGIN } }), env, T0)).json()).scores;

test("GET /top returns an empty table, then what was submitted, with only four fields", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  assert.deepEqual(await topOf(env), []);
  const r = await handle(post(good({ extra: "x", name: "Mauricio" })), env, T0);
  assert.equal(r.status, 200);
  assert.deepEqual(await topOf(env), [{ initials: "ACE", score: 1200, wave: 3, date: T0 }]);
  assert.deepEqual(Object.keys(JSON.parse(env.SCORES.m.get("top"))[0]).sort(), ["date", "initials", "score", "wave"]);
});

test("the table keeps the best 10, sorted", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  for (let i = 1; i <= 12; i++) {
    const r = await handle(post(good({ score: i * 100 }), { "CF-Connecting-IP": "9.9.9." + i }), env, T0 + i);
    assert.equal(r.status, 200);
  }
  const top = await topOf(env);
  assert.equal(top.length, 10);
  assert.equal(top[0].score, 1200);
  assert.equal(top[9].score, 300);
});

test("CORS headers only for https://maumoya.github.io", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const ok = await handle(new Request("https://w.test/top", { headers: { Origin: ORIGIN } }), env, T0);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  for (const origin of ["https://evil.example", "http://maumoya.github.io", "https://maumoya.github.io.evil.example", null]) {
    const headers = origin ? { Origin: origin } : {};
    const r = await handle(new Request("https://w.test/top", { headers }), env, T0);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), null, String(origin));
  }
  const pre = await handle(new Request("https://w.test/submit", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env, T0);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const badPre = await handle(new Request("https://w.test/submit", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env, T0);
  assert.equal(badPre.status, 403);
  assert.equal(badPre.headers.get("Access-Control-Allow-Origin"), null);
});

test("a body over 200 bytes is refused, and so is one that is not JSON", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const big = await handle(post(good({ initials: "x".repeat(300) })), env, T0);
  assert.equal(big.status, 413);
  const edge = JSON.stringify(good());
  assert.ok(edge.length < 200);
  assert.equal((await handle(post(edge + " ".repeat(200 - edge.length)), env, T0)).status, 200, "exactly 200 bytes is fine");
  assert.equal((await handle(post(edge + " ".repeat(201 - edge.length), { "CF-Connecting-IP": "5.5.5.5" }), env, T0)).status, 413);
  assert.equal((await handle(post("hello there"), env, T0)).status, 400);
  assert.equal((await handle(post("[1,2]"), env, T0)).status, 400);
  assert.equal((await handle(post("null"), env, T0)).status, 400);
  assert.deepEqual(await topOf(env), [{ initials: "ACE", score: 1200, wave: 3, date: T0 }], "only the valid one landed");
});

test("the 6th submit in 10 minutes is refused, a later window works again", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  for (let i = 0; i < 5; i++) assert.equal((await handle(post(good({ score: 100 + i })), env, T0 + i * 1000)).status, 200, "submit " + (i + 1));
  assert.equal((await handle(post(good()), env, T0 + 6000)).status, 429);
  assert.equal((await handle(post(good(), { "CF-Connecting-IP": "8.8.8.8" }), env, T0 + 6000)).status, 200, "another player is not limited");
  assert.equal((await handle(post(good()), env, T0 + 10 * 60 * 1000 + 1)).status, 200, "window over");
  for (const [k, ttl] of env.SCORES.ttls) if (k.startsWith("rl:")) assert.ok(ttl >= 60 && ttl <= 600);
});

test("bad initials are cleaned, not refused", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  await handle(post(good({ initials: "a1b2c3" })), env, T0);
  await handle(post(good({ initials: "fuk", score: 1100 }), { "CF-Connecting-IP": "2.2.2.2" }), env, T0);
  await handle(post(good({ initials: 42, score: 1000 }), { "CF-Connecting-IP": "3.3.3.3" }), env, T0);
  assert.deepEqual((await topOf(env)).map((e) => e.initials), ["ABC", "AAA", "AAA"]);
});

test("implausible or malformed scores are refused", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const bad = [
    good({ score: 5001 * 3 }), // over the per-wave cap
    good({ score: 100, seconds: 0 }), // points in zero seconds
    good({ score: 0 }), good({ score: -5 }), good({ score: 1.5 }), good({ score: "900" }),
    good({ wave: 0 }), good({ wave: "3" }), good({ seconds: -1 }), good({ seconds: null }),
    { initials: "ABC" },
  ];
  for (const b of bad) {
    const r = await handle(post(b), env, T0);
    assert.equal(r.status, 422, JSON.stringify(b));
  }
  assert.deepEqual(await topOf(env), []);
  assert.equal(env.SCORES.m.size, 0, "refused scores do not even use up the rate limit");
});

test("other paths and methods are refused", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  assert.equal((await handle(new Request("https://w.test/nope"), env, T0)).status, 404);
  assert.equal((await handle(new Request("https://w.test/submit"), env, T0)).status, 405);
  assert.equal((await handle(new Request("https://w.test/top", { method: "POST", body: "{}" }), env, T0)).status, 405);
});

test("a broken stored table never throws", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  env.SCORES.m.set("top", "not json");
  assert.deepEqual(await topOf(env), []);
  assert.equal((await handle(post(good()), env, T0)).status, 200);
});

test("POST /start hands out a signed ticket; no secret = no tickets", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const r = await handle(new Request("https://w.test/start", { method: "POST", headers: { Origin: ORIGIN } }), env, T0);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await r.json()).ticket, ticketAt(T0));
  assert.equal(env.SCORES.m.size, 0, "a ticket stores nothing");
  assert.equal((await handle(new Request("https://w.test/start", { method: "POST" }), { SCORES: fakeKV() }, T0)).status, 503);
  assert.equal((await handle(new Request("https://w.test/start"), env, T0)).status, 405);
});

test("a score without a real ticket never lands", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const t = T0 - 1_000_000;
  const forged = [
    undefined, "", 42, "nope", t + ".short",
    ticketAt(t, "other-key"), // signed with another secret
    ticketAt(t).slice(0, -1) + (ticketAt(t).endsWith("A") ? "B" : "A"), // one character changed
    (t - 1) + "." + ticketAt(t).split(".")[1], // the time changed under the same signature
    ticketAt(T0 + 60_000), // from the future
    ticketAt(T0 - 3 * 3600_000 - 1000), // older than 3 hours
  ];
  for (const tk of forged) assert.equal((await handle(post(good({ ticket: tk })), env, T0)).status, 403, String(tk));
  assert.deepEqual(await topOf(env), []);
});

test("claims must fit the time the server measured since the ticket", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const at = (s) => ticketAt(T0 - s * 1000); // a ticket handed out s seconds ago
  const tooMuch = [
    good({ ticket: at(60), seconds: 90 }), // claims 90 s of play 60 s after the start
    good({ ticket: at(100), wave: 200, seconds: 100, score: 1000 }), // 200 waves in 100 s
    good({ ticket: at(30), seconds: 3000, score: 30000 }), // long run claimed, short real time: capped by real time
  ];
  for (const b of tooMuch) assert.equal((await handle(post(b), env, T0)).status, 422, JSON.stringify(b));
  assert.equal((await handle(post(good({ ticket: at(80), seconds: 90 })), env, T0)).status, 200, "15 s of slack for rounding");
});

test("each ticket is good for one score only", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  const tk = ticket(T0);
  assert.equal((await handle(post(good({ ticket: tk })), env, T0)).status, 200);
  assert.equal((await handle(post(good({ ticket: tk, score: 1300 })), env, T0 + 1)).status, 409);
  assert.deepEqual((await topOf(env)).map((e) => e.score), [1200]);
});
