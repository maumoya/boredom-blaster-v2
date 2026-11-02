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

const BB = globalThis.BB, IN = globalThis.BBInput, RN = globalThis.BBRender, SC = globalThis.BBScores;

const entry = (score, date, initials = "AAA", wave = 1) => ({ initials, score, wave, date });
const fullTable = () => Array.from({ length: 10 }, (_, i) => entry(1000 - i * 100, i)); // 1000 .. 100
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test("qualifies: any positive score on a short table, must beat the 10th on a full one", () => {
  assert.equal(SC.qualifies([], 1), true);
  assert.equal(SC.qualifies([], 0), false);
  assert.equal(SC.qualifies([], -5), false);
  assert.equal(SC.qualifies([], NaN), false);
  assert.equal(SC.qualifies(fullTable(), 100), false, "a tie with the 10th does not qualify");
  assert.equal(SC.qualifies(fullTable(), 101), true);
});

test("insert: sorted by score, ties keep the earlier date first, cut at 10", () => {
  const { list, index } = SC.insert(fullTable(), entry(550, 99, "NEW"));
  assert.equal(list.length, 10);
  assert.equal(index, 5);
  assert.equal(list[5].initials, "NEW");
  assert.equal(list[9].score, 200, "the old 10th fell off");

  const tie = SC.insert([entry(500, 1, "OLD")], entry(500, 2, "NEW"));
  assert.deepEqual(tie.list.map((e) => e.initials), ["OLD", "NEW"]);
  assert.equal(tie.index, 1);
  const early = SC.insert([entry(500, 5, "LAT")], entry(500, 2, "ERL"));
  assert.equal(early.index, 0);

  const cut = SC.insert(fullTable(), entry(50, 99));
  assert.equal(cut.index, -1);
  assert.equal(cut.list.length, 10);
});

test("insert does not change the list it was given", () => {
  const before = fullTable();
  SC.insert(before, entry(5000, 1));
  assert.equal(before.length, 10);
  assert.equal(before[0].score, 1000);
});

test("cleanInitials: A to Z, 3 letters, uppercase, bad words become AAA", () => {
  assert.equal(SC.cleanInitials("abc"), "ABC");
  assert.equal(SC.cleanInitials("a1b2c3d"), "ABC");
  assert.equal(SC.cleanInitials("zz"), "ZZA", "short input pads with A");
  assert.equal(SC.cleanInitials(""), "AAA");
  assert.equal(SC.cleanInitials(null), "AAA");
  assert.equal(SC.cleanInitials(undefined), "AAA");
  assert.equal(SC.cleanInitials(42), "AAA");
  assert.equal(SC.cleanInitials("ass"), "AAA");
  assert.equal(SC.cleanInitials("S E X"), "AAA");
  for (const w of SC.BAD) assert.equal(SC.cleanInitials(w), "AAA", w);
});

test("plausible: caps per wave and per second, edges included", () => {
  assert.equal(SC.plausible(0, 1, 0), true);
  assert.equal(SC.plausible(SC.MAX_PER_WAVE, 1, 1000), true, "exactly the wave cap");
  assert.equal(SC.plausible(SC.MAX_PER_WAVE + 1, 1, 1000), false);
  assert.equal(SC.plausible(SC.MAX_PER_SECOND * 10, 99, 10), true, "exactly the time cap");
  assert.equal(SC.plausible(SC.MAX_PER_SECOND * 10 + 1, 99, 10), false);
  assert.equal(SC.plausible(100, 1, 0), false, "points in zero seconds");
  assert.equal(SC.plausible(-1, 1, 10), false);
  assert.equal(SC.plausible(10, 0, 10), false, "wave starts at 1");
  assert.equal(SC.plausible(NaN, 1, 10), false);
  assert.equal(SC.plausible(10, 1, Infinity), false);
  assert.equal(SC.plausible("10", 1, 10), false);
});

test("store: saves and loads bb.scores, keeps the top 10", () => {
  const storage = memoryStorage(), store = SC.createStore(storage);
  for (let i = 1; i <= 12; i++) store.add(entry(i * 100, i, "ABC", i));
  const list = store.load();
  assert.equal(list.length, 10);
  assert.equal(list[0].score, 1200);
  assert.equal(list[9].score, 300);
  assert.ok(storage.getItem("bb.scores"));
  assert.deepEqual(SC.createStore(storage).load(), list, "a fresh store reads the same table");
  assert.equal(store.add(entry(50, 99)).index, -1);
});

test("store: a missing or broken store never throws", () => {
  assert.deepEqual(SC.createStore(null).load(), []);
  assert.doesNotThrow(() => SC.createStore(null).save([entry(5, 1)]));
  assert.equal(SC.createStore(null).add(entry(5, 1)).index, 0);
  const junk = memoryStorage();
  for (const v of ["not json", "{}", "null", "[1,null,{\"score\":-3}]"]) {
    junk.setItem("bb.scores", v);
    assert.deepEqual(SC.createStore(junk).load(), [], v);
  }
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.deepEqual(SC.createStore(boom).load(), []);
  assert.doesNotThrow(() => SC.createStore(boom).add(entry(5, 1)));
});

test("store: cleans stored records (initials, floats, missing wave)", () => {
  const storage = memoryStorage();
  storage.setItem("bb.scores", JSON.stringify([{ score: 99.9, initials: "fuk" }, { score: 500, wave: 3, initials: "xy", date: 4 }]));
  const list = SC.createStore(storage).load();
  assert.deepEqual(list.map((e) => [e.initials, e.score, e.wave]), [["XYA", 500, 3], ["AAA", 99, 1]]);
});

test("picker: up/down change the letter, wrapping; left/right change the slot", () => {
  const p = IN.createInitialsPicker();
  assert.equal(p.value(), "AAA");
  p.up(); assert.equal(p.value(), "BAA");
  p.down(); p.down(); assert.equal(p.value(), "ZAA", "wraps down");
  p.up(); assert.equal(p.value(), "AAA", "wraps up");
  p.right(); p.up(); p.up();
  assert.equal(p.value(), "ACA");
  p.right(); p.right(); assert.equal(p.slot, 0, "wraps right");
  p.left(); assert.equal(p.slot, 2, "wraps left");
  p.down(); assert.equal(p.value(), "ACZ");
});

test("picker: touch hit boxes for the arrows, the letters and OK", () => {
  const L = IN.INITIALS_LAYOUT, p = IN.createInitialsPicker();
  assert.deepEqual(p.hit(L.slotX[1], L.upY), { type: "up", slot: 1 });
  assert.deepEqual(p.hit(L.slotX[2], L.downY), { type: "down", slot: 2 });
  assert.deepEqual(p.hit(L.slotX[0], L.letterY), { type: "slot", slot: 0 });
  assert.deepEqual(p.hit(L.ok.x + 1, L.ok.y + 1), { type: "ok" });
  assert.equal(p.hit(0, 0), null);
  assert.equal(p.hit((L.slotX[0] + L.slotX[1]) / 2, L.upY), null, "between slots");

  assert.equal(p.tap(L.slotX[1], L.upY), null);
  assert.equal(p.slot, 1);
  assert.equal(p.value(), "ABA");
  p.tap(L.slotX[2], L.downY);
  assert.equal(p.value(), "ABZ");
  assert.equal(p.tap(L.ok.x + L.ok.w / 2, L.ok.y + L.ok.h / 2), "ok");
});

test("renderer draws the picker, a blinking new row, and the table on results and high scores", () => {
  const log = [];
  const ctx = new Proxy({ canvas: { width: 480, height: 640 } }, {
    get(t, k) { return k in t ? t[k] : (...a) => { log.push({ fn: k, a }); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  const texts = () => log.filter((c) => c.fn === "fillText").map((c) => String(c.a[0]));
  const scores = [entry(900, 1, "ACE", 4), entry(300, 2, "BOB", 2)];
  const r = RN.createRenderer(ctx, null);
  const game = BB.createGame();

  const menu = IN.createMenu({ screen: "initials" });
  r.draw({ game, menu, picker: IN.createInitialsPicker(), time: 1 });
  for (const s of ["NEW RECORD!", "▲", "▼", "OK"]) assert.ok(texts().includes(s), s);

  log.length = 0;
  menu.screen = "results";
  r.draw({ game, menu, scores, highlight: { index: 1, until: 10 }, time: 0 }); // on phase
  assert.ok(texts().includes("ACE") && texts().includes("BOB"));
  log.length = 0;
  r.draw({ game, menu, scores, highlight: { index: 1, until: 10 }, time: 0.2 }); // off phase
  assert.ok(texts().includes("ACE") && !texts().includes("BOB"), "the new row blinks");
  log.length = 0;
  r.draw({ game, menu, scores, highlight: { index: 1, until: 10 }, time: 11 }); // after 3 s
  assert.ok(texts().includes("BOB"), "steady once the blink ends");

  log.length = 0;
  menu.screen = "scores";
  r.draw({ game, menu, scores, time: 0 });
  assert.ok(texts().includes("ACE") && texts().includes("000900"));
});
