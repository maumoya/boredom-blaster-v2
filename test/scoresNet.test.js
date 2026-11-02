import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/assets.js";
import "../src/ui.js";
import "../src/render.js";
import "../src/scores.js";
import "../src/scoresNet.js";

const BB = globalThis.BB, IN = globalThis.BBInput, RN = globalThis.BBRender, NET = globalThis.BBScoresNet;
const API = "https://scores.example.workers.dev";

const reply = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
const entry = (over = {}) => ({ initials: "ace", score: 900, wave: 4, seconds: 100, ticket: "1800000000000.abc", ...over });
const recorderCtx = () => {
  const log = [];
  const ctx = new Proxy({ canvas: { width: 480, height: 640 } }, {
    get(t, k) { return k in t ? t[k] : (...a) => { log.push({ fn: k, a }); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, texts: () => log.filter((c) => c.fn === "fillText").map((c) => String(c.a[0])), log };
};

test("fetchTop: success returns a cleaned table", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push([url, init]); return reply({ scores: [
    { initials: "ace", score: 900.7, wave: 4, date: 5 }, { initials: "x", score: -1 }, null, { initials: "zz", score: 50, wave: "?" },
  ] }); };
  const r = await NET.createClient({ api: API + "/", fetch }).fetchTop();
  assert.equal(calls[0][0], API + "/top");
  assert.equal(r.ok, true);
  assert.deepEqual(r.list.map((e) => [e.initials, e.score, e.wave]), [["ACE", 900, 4], ["ZZA", 50, 1]]);
});

test("fetchTop: failures (network, bad status, bad JSON) resolve to not ok", async () => {
  for (const fetch of [
    async () => { throw new Error("down"); },
    async () => reply({}, false, 500),
    async () => ({ ok: true, json: async () => { throw new Error("junk"); } }),
  ]) {
    const r = await NET.createClient({ api: API, fetch }).fetchTop();
    assert.equal(r.ok, false);
    assert.deepEqual(r.list, []);
  }
});

test("a call that takes longer than 3 seconds gives up", async () => {
  let fire, cleared = 0, waited;
  const setTimeout = (fn, ms) => { fire = fn; waited = ms; return 7; };
  const clearTimeout = (id) => { if (id === 7) cleared++; };
  const never = () => new Promise(() => {});
  const client = NET.createClient({ api: API, fetch: never, setTimeout, clearTimeout });
  const pending = client.fetchTop();
  await Promise.resolve();
  assert.equal(waited, 3000);
  fire();
  assert.deepEqual(await pending, { ok: false, list: [] });
  assert.equal(cleared, 1);
  const sub = client.submit(entry());
  await Promise.resolve();
  fire();
  assert.deepEqual(await sub, { ok: false });
});

test("a fast answer clears the timer", async () => {
  let cleared = 0;
  const client = NET.createClient({ api: API, fetch: async () => reply({ scores: [] }), setTimeout: () => 3, clearTimeout: () => cleared++ });
  assert.equal((await client.fetchTop()).ok, true);
  assert.equal(cleared, 1);
});

test("submit: sends only initials, score, wave and seconds as small JSON", async () => {
  let sent;
  const fetch = async (url, init) => { sent = { url, init }; return reply({ ok: true }); };
  const r = await NET.createClient({ api: API, fetch }).submit(entry({ name: "Mauricio", email: "a@b.c" }));
  assert.deepEqual(r, { ok: true });
  assert.equal(sent.url, API + "/submit");
  assert.equal(sent.init.method, "POST");
  assert.deepEqual(JSON.parse(sent.init.body), { initials: "ACE", score: 900, wave: 4, seconds: 100, ticket: "1800000000000.abc" });
  assert.ok(sent.init.body.length < 200);
});

test("submit: failure resolves not ok, implausible scores are never sent", async () => {
  assert.deepEqual(await NET.createClient({ api: API, fetch: async () => reply({}, false, 429, ) }).submit(entry()), { ok: false });
  assert.deepEqual(await NET.createClient({ api: API, fetch: async () => { throw new Error("x"); } }).submit(entry()), { ok: false });
  let calls = 0;
  const client = NET.createClient({ api: API, fetch: async () => { calls++; return reply({}); } });
  const r = await client.submit(entry({ score: 999999, wave: 1, seconds: 10 }));
  assert.equal(r.ok, false);
  assert.equal(r.implausible, true);
  assert.equal(calls, 0);
});

test("empty API: offline, nothing is ever sent", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return reply({}); };
  const client = NET.createClient({ api: "", fetch });
  assert.equal(client.enabled, false);
  assert.deepEqual(await client.fetchTop(), { ok: false, offline: true, list: [] });
  assert.deepEqual(await client.submit(entry()), { ok: false, offline: true });
  assert.equal(NET.API, "https://boredom-blaster-scores.maumoya85.workers.dev", "the shipped API address is the deployed Worker");
  assert.equal(NET.createClient({ fetch }).enabled, true);
  assert.equal(calls, 0);
});

test("plausible() and cleanInitials() are the one shared pair", () => {
  assert.equal(typeof globalThis.BBScores.plausible, "function");
  assert.equal(globalThis.BBScores.cleanInitials("a1"), "AAA");
});

test("high-score screen: GLOBAL and THIS DEVICE tabs; offline shows the local table", () => {
  const { ctx, texts } = recorderCtx();
  const r = RN.createRenderer(ctx, null), game = BB.createGame();
  const menu = IN.createMenu({ screen: "scores" });
  const local = [{ initials: "LOC", score: 700, wave: 2, date: 1 }];

  r.draw({ game, menu, scores: local, tab: "global", net: { status: "offline", list: [] }, time: 0 });
  for (const s of ["GLOBAL", "THIS DEVICE", "LOC", "OFFLINE - showing this device"]) assert.ok(texts().includes(s), s);

  const second = recorderCtx();
  RN.createRenderer(second.ctx, null).draw({ game, menu, scores: local, tab: "device", net: { status: "offline", list: [] }, time: 0 });
  assert.ok(second.texts().includes("LOC"));
  assert.ok(!second.texts().includes("OFFLINE - showing this device"), "the device tab has no offline note");
});

test("high-score screen: GLOBAL shows the server table, or a note while loading or on error", () => {
  const game = BB.createGame(), menu = IN.createMenu({ screen: "scores" });
  const local = [{ initials: "LOC", score: 700, wave: 2, date: 1 }];
  const world = [{ initials: "WLD", score: 5000, wave: 9, date: 2 }];
  const draw = (net) => {
    const rec = recorderCtx();
    RN.createRenderer(rec.ctx, null).draw({ game, menu, scores: local, tab: "global", net, time: 0 });
    return rec.texts();
  };
  const ok = draw({ status: "ok", list: world });
  assert.ok(ok.includes("WLD") && !ok.includes("LOC"));
  const loading = draw({ status: "loading", list: [] });
  assert.ok(loading.includes("Loading...") && !loading.includes("LOC"));
  const err = draw({ status: "error", list: [] });
  assert.ok(err.includes("Can't reach the server - showing this device") && err.includes("LOC"));
});

test("tab hit boxes", () => {
  const g = RN.SCORE_TABS.global, d = RN.SCORE_TABS.device;
  assert.equal(RN.scoreTabHit(g.x + 5, g.y + 5), "global");
  assert.equal(RN.scoreTabHit(d.x + 5, d.y + 5), "device");
  assert.equal(RN.scoreTabHit(0, 0), null);
  assert.equal(RN.scoreTabHit(g.x + 5, g.y + g.h + 50), null);
});

test("start: returns the server's ticket or null; submit without a ticket sends nothing", async () => {
  let calls = 0;
  const ok = NET.createClient({ api: API, fetch: async (url, init) => { calls++; assert.equal(url, API + "/start"); assert.equal(init.method, "POST"); return reply({ ticket: "1.x" }); } });
  assert.equal(await ok.start(), "1.x");
  assert.equal(await NET.createClient({ api: API, fetch: async () => reply({}, false, 503) }).start(), null);
  assert.equal(await NET.createClient({ api: API, fetch: async () => reply({ ticket: 5 }) }).start(), null);
  assert.equal(await NET.createClient({ api: "", fetch: async () => reply({}) }).start(), null);
  const r = await ok.submit(entry({ ticket: null }));
  assert.deepEqual(r, { ok: false, noTicket: true });
  assert.equal(calls, 1);
});
