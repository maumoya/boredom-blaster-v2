import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/scores.js";
import "../src/enemies.js";
import "../src/playStats.js";
import { handle } from "../worker/scores.js";
import { createHmac } from "node:crypto";

const KEY = "k-test";
// a run ticket made the way the Worker signs them (written here on its own, so a slip on either side shows)
const ticketAt = (t, key = KEY) => t + "." + createHmac("sha256", "bb-ticket:" + key).update("run:" + t).digest("base64url").slice(0, 27);
let made = 0;
const ticket = (base) => ticketAt(base - 1_000_000 - made++); // a fresh ticket from ~17 minutes before base

const P = globalThis.BBPlayStats;
const ORIGIN = "https://maumoya.github.io";
const T0 = Date.UTC(2026, 9, 29, 12);
const fakeKV = () => {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } };
};
const run = (over = {}) => ({ world: 1, wave: 23, seconds: 140, score: 5400, end: "over", device: "phone", ...over });
const postEvent = (body, ip = "1.2.3.4", country = "MX") => {
  const r = new Request("https://w.test/event", { method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": ip }, body: JSON.stringify({ ticket: ticket(T0), ...body }) });
  Object.defineProperty(r, "cf", { value: { country } });
  return r;
};
const getStats = (auth) => new Request("https://w.test/stats?days=3", { headers: auth ? { Authorization: auth } : {} });

test("a run line holds only small numbers and fixed words", () => {
  const e = P.runEvent({ wave: 150, score: 9876.5 }, 301.4, "quit", "tablet");
  assert.deepEqual(e, { world: 2, wave: 150, seconds: 301, score: 9876, end: "quit", device: "tablet" });
  assert.equal(P.runEvent({ wave: 3, score: 1 }, 10, "x", "fridge").device, "desktop");
  assert.equal(P.deviceOf(390, 844, true), "phone");
  assert.equal(P.deviceOf(820, 1180, true), "tablet");
  assert.equal(P.deviceOf(1440, 900, false), "desktop");
});

test("Do Not Track and Global Privacy Control turn sending off; short runs are never sent", async () => {
  const sent = [];
  const fetch = async (url, init) => { sent.push([url, init]); return {}; };
  assert.equal(P.createClient({ api: "https://x.test", fetch, nav: { doNotTrack: "1" } }).enabled, false);
  assert.equal(P.createClient({ api: "https://x.test", fetch, nav: { globalPrivacyControl: true } }).enabled, false);
  assert.equal(P.createClient({ api: "", fetch, nav: {} }).enabled, false);
  const c = P.createClient({ api: "https://x.test/", fetch, nav: {} });
  assert.equal(await c.send(run({ seconds: 3 }), "t.x"), false);
  assert.equal(await c.send(run()), false, "a run without a ticket sends nothing");
  assert.equal(await c.send(run(), "t.x"), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "https://x.test/event");
  assert.equal(sent[0][1].keepalive, true);
  assert.deepEqual(JSON.parse(sent[0][1].body), { ...run(), ticket: "t.x" });
});

test("the device counts times played and time played, and survives blocked storage", () => {
  const m = new Map();
  const local = P.createLocal({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) });
  assert.equal(P.line(local.load()), "");
  local.add(50);
  assert.equal(P.line(local.add(3700)), "PLAYED 2 TIMES - 1 H 02 MIN");
  assert.equal(P.line({ runs: 1, seconds: 125 }), "PLAYED 1 TIME - 2 MIN");
  const blocked = P.createLocal(null);
  assert.deepEqual(blocked.add(10), { runs: 1, seconds: 10 });
});

test("POST /event adds into one daily counter with country, device, wave bucket, world and end", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  assert.equal((await handle(postEvent(run()), env, T0)).status, 200);
  assert.equal((await handle(postEvent(run({ wave: 7, device: "desktop", end: "quit" }), "5.6.7.8", "ES"), env, T0 + 1000)).status, 200);
  const st = JSON.parse(env.SCORES.m.get("st:2026-10-29"));
  assert.equal(st.runs, 2);
  assert.equal(st.seconds, 280);
  assert.equal(st.bestWave, 23);
  assert.deepEqual(st.countries, { MX: 1, ES: 1 });
  assert.deepEqual(st.devices, { phone: 1, desktop: 1 });
  assert.deepEqual(st.waves, { "21": 1, "1": 1 });
  assert.deepEqual(st.ends, { over: 1, quit: 1 });
  assert.ok(![...env.SCORES.m.keys()].some((k) => k.includes("1.2.3.4")), "no address is stored");
});

test("POST /event refuses bad lines and floods", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  assert.equal((await handle(postEvent(run({ wave: -1 })), env, T0)).status, 422);
  assert.equal((await handle(postEvent(run({ device: "<script>" })), env, T0)).status, 422);
  assert.equal((await handle(postEvent({ ...run(), pad: "x".repeat(400) }), env, T0)).status, 413);
  let last;
  for (let i = 0; i < 31; i++) last = await handle(postEvent(run()), env, T0 + i);
  assert.equal(last.status, 429);
});

test("GET /stats needs the owner key", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: "k-test" };
  await handle(postEvent(run()), env, T0);
  assert.equal((await handle(getStats(), env, T0)).status, 403);
  assert.equal((await handle(getStats("Bearer nope"), env, T0)).status, 403);
  assert.equal((await handle(getStats("Bearer k-test"), { SCORES: env.SCORES }, T0)).status, 403, "no key set = closed");
  const r = await handle(getStats("Bearer k-test"), env, T0);
  assert.equal(r.status, 200);
  const { days } = await r.json();
  assert.equal(days.length, 1);
  assert.equal(days[0].day, "2026-10-29");
  assert.equal(days[0].runs, 1);
});

test("POST /event needs a real, unused ticket that fits the run", async () => {
  const env = { SCORES: fakeKV(), STATS_KEY: KEY };
  assert.equal((await handle(postEvent(run({ ticket: undefined })), env, T0)).status, 403);
  assert.equal((await handle(postEvent(run({ ticket: ticketAt(T0 - 1_000_000, "x") })), env, T0)).status, 403);
  assert.equal((await handle(postEvent(run({ ticket: ticketAt(T0 - 20_000) })), env, T0)).status, 422, "140 s claimed 20 s after start");
  const tk = ticket(T0);
  assert.equal((await handle(postEvent(run({ ticket: tk })), env, T0)).status, 200);
  assert.equal((await handle(postEvent(run({ ticket: tk })), env, T0 + 1)).status, 409);
  assert.equal(JSON.parse(env.SCORES.m.get("st:2026-10-29")).runs, 1);
});
