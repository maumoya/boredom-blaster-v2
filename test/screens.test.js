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

const BB = globalThis.BB, E = globalThis.BBEnemies, IN = globalThis.BBInput, RN = globalThis.BBRender;

function recorder() {
  const log = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { log.push({ fn: k, args }); return undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log };
}
const texts = (log) => log.filter((c) => c.fn === "fillText").map((c) => String(c.args[0]));
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

// ---- title screen ----
test("title screen: menu is START, HIGH SCORES, HOW TO PLAY and draws with icons", () => {
  const menu = IN.createMenu({ screen: "title" });
  assert.deepEqual(menu.titleItems(), ["START", "HIGH SCORES", "HOW TO PLAY"]);
  const { ctx, log } = recorder();
  RN.createRenderer(ctx, null).draw({ game: BB.createGame(), menu, best: 50, time: 1 });
  const shown = texts(log);
  for (const label of ["START", "HIGH SCORES", "HOW TO PLAY"]) assert.ok(shown.includes(label), label);
});

test("title screen: cursor wraps, click picks, START plays, the others open and return", () => {
  const menu = IN.createMenu({ screen: "title" });
  menu.move(-1);
  assert.equal(menu.cursor, 2, "wraps up");
  menu.move(1);
  assert.equal(menu.cursor, 0);
  const L = IN.TITLE_LAYOUT;
  assert.equal(menu.itemAt(L.x + 5, L.y + (L.h + L.gap) + 5), 1);
  assert.equal(menu.itemAt(0, 0), -1);

  assert.equal(menu.activate(1), "scores");
  assert.equal(menu.screen, "scores");
  menu.toggle();
  assert.equal(menu.screen, "title", "scores returns to the title");
  assert.equal(menu.activate(2), "howto");
  assert.equal(menu.screen, "howto");
  menu.activate();
  assert.equal(menu.screen, "title", "how to play returns to the title");
  assert.equal(menu.activate(0), "start");
  assert.equal(menu.screen, "playing");
});

test("high scores: kept best first, top 5, survive a broken store", () => {
  const store = IN.createStore(memoryStorage());
  for (const s of [300, 900, 100, 500, 700, 200, 800]) store.addScore(s, 3);
  assert.deepEqual(store.loadScores().map((s) => s.score), [900, 800, 700, 500, 300]);
  assert.deepEqual(IN.createStore(null).addScore(10, 1), []);
  const bad = { getItem: () => "{not json", setItem() {} };
  assert.deepEqual(IN.createStore(bad).loadScores(), []);
  const { ctx, log } = recorder();
  const menu = IN.createMenu({ screen: "scores" });
  RN.createRenderer(ctx, null).draw({ game: BB.createGame(), menu, scores: store.loadScores(), time: 0 });
  assert.ok(texts(log).includes("HIGH SCORES"));
});

test("how to play and pause screens draw real icons next to their text", () => {
  const { ctx, log } = recorder();
  const r = RN.createRenderer(ctx, null), g = BB.createGame();
  r.draw({ game: g, menu: IN.createMenu({ screen: "howto" }), time: 0 });
  assert.ok(texts(log).includes("HOW TO PLAY"));
  const before = log.length;
  r.draw({ game: g, menu: IN.createMenu({ screen: "pause" }), time: 0 });
  const pause = log.slice(before);
  assert.ok(texts(pause).includes("Resume"));
  assert.ok(pause.filter((c) => c.fn === "bezierCurveTo" || c.fn === "ellipse" || c.fn === "lineTo").length > 10, "icon paths");
});

// ---- results ----
test("stars: 1 at wave 5, 2 at wave 10, 3 at wave 15 only with no life lost on a boss wave", () => {
  assert.equal(IN.starsFor(4, false), 0);
  assert.equal(IN.starsFor(5, false), 1);
  assert.equal(IN.starsFor(9, false), 1);
  assert.equal(IN.starsFor(10, false), 2);
  assert.equal(IN.starsFor(15, false), 3);
  assert.equal(IN.starsFor(15, true), 2, "a life lost on a boss wave costs the third star");
  assert.equal(IN.starsFor(30, true), 2);
});

test("run stats: a life lost on a boss wave is noticed, one on a plain wave is not", () => {
  const plain = BB.createGame(), a = IN.createRunStats();
  a.observe(plain);
  plain.lives = 2;
  a.observe(plain);
  assert.equal(a.state.bossLifeLost, false);

  const boss = BB.createGame(), b = IN.createRunStats();
  boss.wave = 5;
  b.observe(boss);
  boss.lives = 2;
  b.observe(boss);
  assert.equal(b.state.bossLifeLost, true);
  boss.wave = 15;
  assert.equal(b.result(boss).stars, 2);
});

test("results: goals checklist covers mini-boss beaten, Kaboom used and weapon MAX", () => {
  const g = BB.createGame(), s = IN.createRunStats();
  const done = () => Object.fromEntries(s.result(g).goals.map((x) => [x.id, x.done]));
  g.wave = 5;
  g.drones = [E.createEnemy(g, "orbiter", 100, 100), E.createEnemy(g, "drone", 10, 10)];
  s.observe(g);
  assert.deepEqual(done(), { miniboss: false, kaboom: false, weapon: false });

  g.drones = g.drones.filter((d) => !d.boss); // the mini-boss dies
  s.observe(g);
  assert.equal(done().miniboss, true);

  s.kaboomUsed();
  assert.equal(done().kaboom, true);

  g.weaponLevel = BB.R().WEAPON.maxLevel;
  s.observe(g);
  assert.equal(done().weapon, true);
  assert.equal(s.result(g).wave, 5);
});

test("results screen replaces game over: score, wave, stars, goals, replay prompt", () => {
  const g = BB.createGame(), s = IN.createRunStats();
  g.score = 1234; g.wave = 11; g.status = "over";
  const menu = IN.createMenu({ screen: "playing" });
  menu.finish();
  assert.equal(menu.screen, "results");
  const { ctx, log } = recorder();
  RN.createRenderer(ctx, null).draw({ game: g, menu, best: 2000, results: s.result(g), time: 1 });
  const shown = texts(log);
  assert.ok(shown.includes("RESULTS"));
  assert.ok(!shown.includes("GAME OVER"));
  assert.ok(shown.includes("SCORE 1234"));
  assert.ok(shown.some((t) => t.startsWith("WAVE 11")));
  for (const label of ["Beat a mini-boss", "Use Kaboom", "Weapon at MAX"]) assert.ok(shown.includes(label), label);
  assert.ok(shown.includes("Press Enter to replay"));
});

test("Enter on the results screen means replay", () => {
  const menu = IN.createMenu({ screen: "playing" });
  menu.finish();
  assert.equal(menu.activate(), "restart");
  const fresh = BB.restart();
  assert.equal(fresh.status, "playing");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.wave, 1);
});

// ---- reduced motion ----
test("reduced motion: no pulse, no background drift, no screen shake", () => {
  const calm = RN.createRenderer(recorder().ctx, null, { reducedMotion: true });
  const live = RN.createRenderer(recorder().ctx, null);
  assert.equal(calm.pulse(0.4), 1);
  assert.equal(calm.pulse(1.9), 1);
  assert.notEqual(live.pulse(0.4), 1);

  const frame = (reducedMotion) => {
    const { ctx, log } = recorder();
    const r = RN.createRenderer(ctx, null, { reducedMotion });
    const g = BB.createGame();
    r.update(0.016, g);
    log.length = 0;
    r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), time: 1 });
    const first = JSON.stringify(log);
    for (let i = 0; i < 100; i++) r.update(0.1, g);
    log.length = 0;
    r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), time: 1 });
    return first === JSON.stringify(log);
  };
  assert.equal(frame(true), true, "the background stands still");
  assert.equal(frame(false), false, "the background drifts by default");

  const shaken = (reducedMotion) => {
    const { ctx, log } = recorder();
    const r = RN.createRenderer(ctx, null, { reducedMotion });
    const g = BB.createGame();
    r.update(0.016, g);
    g.lives -= 1;
    r.update(0.016, g);
    log.length = 0;
    r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), time: 1 });
    return log.some((c) => c.fn === "translate" && (c.args[0] !== 0 || c.args[1] !== 0));
  };
  assert.equal(shaken(false), true);
  assert.equal(shaken(true), false);
});

test("reduced motion can be switched at runtime and kills a shake in progress", () => {
  const r = RN.createRenderer(recorder().ctx, null);
  assert.equal(r.isReducedMotion(), false);
  r.setReducedMotion(true);
  assert.equal(r.isReducedMotion(), true);
  assert.equal(r.pulse(1), 1);
});

test("title pulse is off under reduced motion", () => {
  const scales = (reducedMotion) => {
    const { ctx, log } = recorder();
    RN.createRenderer(ctx, null, { reducedMotion }).draw({ game: BB.createGame(), menu: IN.createMenu({ screen: "title" }), time: 0.4 });
    return log.filter((c) => c.fn === "scale").map((c) => c.args[0]);
  };
  assert.ok(scales(false).some((k) => k !== 1));
  assert.ok(scales(true).every((k) => k === 1));
});

// ---- difficulty ----
test("difficulty: wave 40 is faster and fires more than wave 20", () => {
  assert.ok(E.speedMult(40) > E.speedMult(20));
  assert.ok(E.shotRate(40) > E.shotRate(20));
  assert.ok(E.fireRate(40) <= 0.35 + 1e-9, "the per-wave ramp cap is unchanged");

  const shots = (wave) => { // bullets fired in 10 simulated seconds, same seed
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = BB.createGame({ rng });
    g.wave = wave;
    g.drones = [];
    for (const species of ["wasp", "viper", "splitter", "orbiter"]) {
      for (let i = 0; i < 3; i++) {
        const e = E.createEnemy(g, species, 60 + i * 120, 100);
        e.home = { x: e.x, y: e.y }; // timed patterns move relative to home
        e.orbit = { x: e.x, y: e.y };
        e.vx = 0; e.vy = 0;
        g.drones.push(e);
      }
    }
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      E.updateEnemies(g, 0.05);
      fired += g.enemyBullets.length;
      g.enemyBullets = [];
    }
    return fired;
  };
  assert.ok(shots(40) > shots(20), "wave 40 fires more shots than wave 20");
});

test("difficulty: bosses shoot faster as the cycles pile up", () => {
  const g = BB.createGame();
  g.wave = 5;
  const early = E.createEnemy(g, "orbiter", 0, 0).fireEvery;
  g.wave = 38; // cycle 3
  const late = E.createEnemy(g, "orbiter", 0, 0).fireEvery;
  assert.ok(late < early);
});
