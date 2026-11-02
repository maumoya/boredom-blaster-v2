import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/worlds.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/ui.js";
import "../src/render.js";

const BB = globalThis.BB, WD = globalThis.BBWorlds, E = BB.E(), IN = globalThis.BBInput, RN = globalThis.BBRender;
const at = (cx, cy) => ({ x: cx - BB.DRONE.w / 2, y: cy - BB.DRONE.h / 2, w: BB.DRONE.w, h: BB.DRONE.h });
const still = (g, drones) => { g.drones = drones; g.dir = 0; g.cooldown = 0; return g; };
const rng = () => 0.5;

// ---- Kaboom: the missile ----

test("kaboom launches a missile that flies 0.5 s toward the densest group before anything dies", () => {
  const g = BB.createGame({ rng });
  const lone = at(440, 80), pack = [at(100, 300), at(130, 320), at(160, 300), at(130, 280)];
  still(g, [lone, ...pack]);
  g.kaboomCharges = 1;
  assert.equal(BB.kaboom(g), true);
  assert.equal(g.kaboomCharges, 0);
  assert.equal(g.missiles.length, 1);
  const m = g.missiles[0];
  assert.equal(m.dur, 0.5);
  assert.ok(Math.hypot(m.tx - 130, m.ty - 300) < 1, "aims at the middle of the pack, not the lone drone");
  BB.update(g, 0.49, {});
  assert.equal(g.nukes, 0, "still flying at 0.49 s");
  assert.equal(g.drones.length, 5);
  assert.ok(g.missiles[0].y < g.ship.y && g.missiles[0].y > m.ty, "partway between the ship and the target");
  BB.update(g, 0.02, {});
  assert.equal(g.nukes, 1, "the blast lands at 0.5 s");
  assert.equal(g.missiles.length, 0);
  assert.deepEqual(g.drones, [lone]);
});

test("kaboom with no enemies still flies and blasts the sky", () => {
  const g = BB.createGame({ rng });
  g.kaboomCharges = 1;
  still(g, []);
  assert.equal(BB.kaboom(g), true);
  assert.equal(g.missiles.length, 1);
});

// ---- Kaboom: the blast ----

test("the nuke kills enemies and enemy bullets within 220 px only, and scores without recharging", () => {
  const g = BB.createGame({ rng });
  const P = { x: 240, y: 250 };
  const a = at(P.x - 100, P.y), b = at(P.x + 100, P.y); // a pair 200 apart: the densest group, centred on P
  const inside = at(P.x, P.y + 215), outside = at(P.x, P.y - 225);
  still(g, [a, b, inside, outside]);
  g.enemyBullets = [
    { x: P.x, y: P.y, w: 6, h: 10, vx: 0, vy: 0 },
    { x: P.x + 230, y: P.y, w: 6, h: 10, vx: 0, vy: 0 },
  ];
  g.kaboomCharges = 1;
  const score = g.score;
  BB.kaboom(g);
  assert.ok(Math.hypot(g.missiles[0].tx - P.x, g.missiles[0].ty - P.y) < 1);
  BB.update(g, 0.5, {});
  assert.equal(g.nukes, 1);
  assert.deepEqual(g.drones, [outside], "only the drone outside the radius survives");
  assert.equal(g.enemyBullets.length, 1);
  assert.ok(g.enemyBullets[0].x > P.x + 200, "the far bullet is untouched");
  assert.equal(g.score, score + 3 * BB.DRONE.points);
  assert.equal(g.kills, 0, "blast kills do not recharge Kaboom");
  assert.equal(g.nuke.radius, 220);
  assert.equal(g.nuke.dur, 0.6);
  BB.update(g, 0.7, {});
  assert.equal(g.nuke, null, "the blast effect ends after 0.6 s");
});

test("the nuke does 10 damage to a mini-boss and leaves it alive", () => {
  const g = BB.createGame({ rng });
  const boss = E.createEnemy(g, "orbiter", 200, 200);
  boss.pattern = "formation"; boss.fireTimer = Infinity;
  still(g, [boss]);
  g.kaboomCharges = 1;
  BB.kaboom(g);
  BB.update(g, 0.5, {});
  assert.equal(g.nukes, 1);
  assert.equal(boss.hp, boss.maxHp - 10);
  assert.deepEqual(g.drones, [boss]);
});

// ---- worlds.js ----

test("worlds: 1 at waves 1-100, 2 at 101-200, five worlds, then the loop starts over", () => {
  const w = WD.worldOf;
  assert.deepEqual([1, 50, 100].map(w), [1, 1, 1]);
  assert.deepEqual([101, 200].map(w), [2, 2]);
  assert.deepEqual([201, 300, 301, 400, 401, 500].map(w), [3, 3, 4, 4, 5, 5]);
  assert.deepEqual([501, 600, 601].map(w), [1, 1, 2]);
  assert.equal(WD.loopOf(500), 0);
  assert.equal(WD.loopOf(501), 1);
  assert.equal(WD.loopOf(1001), 2);
  assert.equal(WD.WORLDS.length, 5);
});

test("worlds: the background shifts every 10 waves and a new distant layer appears", () => {
  assert.deepEqual([1, 10, 11, 20, 91, 100, 101].map(WD.shiftOf), [0, 0, 1, 1, 9, 9, 0]);
  const a = WD.infoFor(10), b = WD.infoFor(11);
  assert.equal(a.layers + 1, b.layers);
  assert.notEqual(WD.cloudColor(a, 0), WD.cloudColor(b, 0), "the hue moves");
  assert.equal(WD.cloudColor(WD.infoFor(5), 0), WD.cloudColor(WD.infoFor(9), 0), "no change inside a block of 10 waves");
});

test("worlds: after world 5 the colours come back deeper", () => {
  const light = (wave) => Number(WD.cloudColor(WD.infoFor(wave), 0).split(",")[2].replace("%", ""));
  assert.ok(light(501) < light(1));
  assert.equal(WD.infoFor(501).name, "Nebula Drift");
  assert.equal(WD.infoFor(501).loop, 1);
});

test("worlds: each has its own name, feature, tint and colours", () => {
  assert.deepEqual(WD.WORLDS.map((x) => x.name), ["Nebula Drift", "Frost Belt", "Ember Sun", "Crystal Void", "Event Horizon"]);
  assert.equal(new Set(WD.WORLDS.map((x) => x.feature)).size, 5);
  assert.equal(new Set(WD.WORLDS.map((x) => x.sky)).size, 5);
  assert.equal(new Set(WD.WORLDS.map((x) => x.tint.halo)).size, 5);
});

test("worlds: a title card appears when the world changes, not inside a world", () => {
  assert.equal(WD.titleCard(100, 101), "WORLD 2: FROST BELT");
  assert.equal(WD.titleCard(200, 201), "WORLD 3: EMBER SUN");
  assert.equal(WD.titleCard(300, 301), "WORLD 4: CRYSTAL VOID");
  assert.equal(WD.titleCard(400, 401), "WORLD 5: EVENT HORIZON");
  assert.equal(WD.titleCard(500, 501), "WORLD 1: NEBULA DRIFT - LOOP 2");
  assert.equal(WD.titleCard(1, 2), null);
  assert.equal(WD.titleCard(110, 111), null);
  assert.equal(WD.titleCard(null, 1), "WORLD 1: NEBULA DRIFT", "a new run opens with its card");
});

test("?wave=N starts the run at wave N", () => {
  assert.equal(WD.startWave("?wave=40"), 40);
  assert.equal(WD.startWave("?x=1&wave=250"), 250);
  for (const bad of ["", "?wave=", "?wave=abc", "?wave=0", "?wave=-5", "?wave=2.5", undefined]) assert.equal(WD.startWave(bad), 1, String(bad));
  assert.equal(WD.startWave("?wave=999999"), WD.MAX_START_WAVE);
  const g = BB.createGame({ rng, wave: 250 });
  const s = E.waveScript(250);
  assert.equal(g.wave, 250);
  assert.equal(g.drones.length, s.drones.cols * s.drones.rows + s.groups.reduce((n, x) => n + x.count, 0));
  assert.equal(BB.restart({ rng, wave: 101 }).wave, 101);
  assert.equal(BB.createGame().wave, 1);
});

// ---- the maximum possible score ----

test("max score counts every spawned enemy's points", () => {
  assert.equal(BB.createGame({ rng }).maxScore, 10 * BB.DRONE.points); // wave 1: a 5x2 grid
  assert.equal(BB.createGame({ rng, wave: 2 }).maxScore, 12 * 10 + 4 * 15); // 6x2 drones and 4 wasps
});

test("max score uses the Score per hit multiplier of the moment, and the score never passes it", () => {
  const g = BB.createGame({ rng });
  g.skills.score = 2; // x1.2: 12 points a drone
  const before = g.maxScore;
  still(g, []); // the wave is empty: the next update spawns wave 2
  BB.update(g, 0.01, {});
  assert.equal(g.wave, 2);
  assert.equal(g.maxScore, before + 12 * 12 + 4 * Math.round(15 * 1.2));
});

test("max score: a multiplier that rises after spawning, and splitter children, keep score <= max", () => {
  const g = BB.createGame({ rng, wave: 6 });
  const spawned = g.maxScore;
  assert.equal(spawned, 12 * 10 + 3 * 30);
  const splitter = g.drones.find((d) => d.species === "splitter");
  splitter.entry = null; splitter.delay = 0;
  g.drones = [splitter];
  splitter.x = 200; splitter.y = 200; splitter.fireTimer = Infinity;
  g.bullets = [{ x: 190, y: 200, w: 60, h: 40, pierce: true }];
  BB.update(g, 0.001, {});
  assert.ok(splitter.dead);
  assert.equal(g.maxScore, spawned + 2 * 5, "two splitlings of 5 points join the maximum");
  g.skills.score = 3; // the multiplier rises after the enemies spawned
  for (const child of g.drones) child.fireTimer = Infinity;
  const child = g.drones[0];
  g.bullets = [{ x: child.x - 2, y: child.y - 2, w: 60, h: 40, pierce: true }];
  BB.update(g, 0.001, {});
  assert.ok(g.maxScore > spawned + 10, "the raised multiplier adds to the maximum");
  assert.ok(g.score <= g.maxScore, `${g.score} <= ${g.maxScore}`);
});

test("results: score / max, the percentage, and the 3rd star needs 70 %", () => {
  const res = (score, stars) => WD.withMax({ score, wave: 20, stars, goals: [] }, { maxScore: 15000 });
  assert.equal(res(12400, 3).line, "12,400 / 15,000 — 83 %");
  assert.equal(res(12400, 3).pct, 83);
  assert.equal(res(12400, 3).max, 15000);
  assert.equal(res(12400, 3).stars, 3);
  assert.equal(res(10500, 3).stars, 3, "exactly 70 % keeps the star");
  assert.equal(res(10499, 3).stars, 2, "just under 70 % loses the 3rd star");
  assert.equal(res(5000, 2).stars, 2, "the other stars are not touched");
  assert.equal(res(5000, 1).stars, 1);
  assert.equal(WD.withMax({ score: 0, wave: 1, stars: 0, goals: [] }, { maxScore: 0 }).pct, 0);
});

// ---- drawing ----

function recorder() {
  const texts = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "fillText") return (s) => texts.push(s);
      return () => undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, texts };
}

test("every world draws on a stub canvas, with a missile and a nuke in flight", () => {
  for (const wave of [1, 15, 101, 201, 301, 401, 450, 501, 601]) {
    for (const reducedMotion of [false, true]) {
      const { ctx } = recorder();
      const r = RN.createRenderer(ctx, null, { reducedMotion });
      const g = BB.createGame({ rng, wave });
      const menu = IN.createMenu({ screen: "playing" });
      g.kaboomCharges = 1;
      BB.kaboom(g);
      r.update(0.016, g);
      assert.doesNotThrow(() => r.draw({ game: g, menu, best: 0, time: 1 }), `wave ${wave}`);
      BB.update(g, 0.5, {});
      r.update(0.016, g);
      assert.ok(g.nuke, "the blast is on");
      assert.doesNotThrow(() => r.draw({ game: g, menu, best: 0, time: 1 }), `blast at wave ${wave}`);
    }
  }
});

test("the world title card is drawn when a run opens and when the world changes", () => {
  const { ctx, texts } = recorder();
  const r = RN.createRenderer(ctx, null);
  const g = BB.createGame({ rng, wave: 100 });
  const menu = IN.createMenu({ screen: "playing" });
  r.update(0.016, g);
  r.draw({ game: g, menu, best: 0, time: 1 });
  assert.ok(texts.includes("WORLD 1: NEBULA DRIFT"));
  r.update(5, g); // the card times out
  texts.length = 0;
  r.draw({ game: g, menu, best: 0, time: 1 });
  assert.ok(!texts.some((t) => String(t).startsWith("WORLD")));
  g.wave = 101;
  r.update(0.016, g);
  r.draw({ game: g, menu, best: 0, time: 1 });
  assert.ok(texts.includes("WORLD 2: FROST BELT"));
});

test("the results screen shows score / max and the percentage", () => {
  const { ctx, texts } = recorder();
  const r = RN.createRenderer(ctx, null);
  const g = BB.createGame({ rng });
  const results = WD.withMax({ score: 12400, wave: 20, stars: 3, goals: [] }, { maxScore: 15000 });
  r.draw({ game: g, menu: IN.createMenu({ screen: "results" }), best: 0, time: 1, scores: [], results });
  assert.ok(texts.includes("12,400 / 15,000 — 83 %"));
  texts.length = 0;
  r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, time: 1 });
  assert.ok(!texts.some((t) => String(t).includes(" / ") && String(t).includes("%")), "no maximum shown during play");
});
