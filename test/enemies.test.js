import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";

const BB = globalThis.BB;
const E = globalThis.BBEnemies;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// small deterministic random source so the tests never flake
function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// a fresh game whose whole field is replaced by the enemies of one wave script
function gameWith(wave) {
  const g = BB.createGame({ rng: seeded() });
  g.wave = wave;
  g.drones = E.spawnEnemies(g, E.waveScript(wave));
  return g;
}

// skip the entry swoop: the enemy is already on its home spot, active and not about to fire
function parkAtHome(e) {
  e.entry = null; e.delay = 0; e.fireTimer = Infinity;
  e.x = e.home.x; e.y = e.home.y;
}

const speciesOf =(g) => [...new Set(g.drones.map((d) => d.species))].sort();

// ---- Catmull-Rom paths ----

test("catmullRom starts at the first point, ends exactly at the last and passes the middle points", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 20 }, { x: 300, y: 300 }];
  assert.deepEqual(E.catmullRom(pts, 0), { x: 0, y: 0 });
  assert.deepEqual(E.catmullRom(pts, 1), { x: 300, y: 300 });
  assert.deepEqual(E.catmullRom(pts, 5), { x: 300, y: 300 }, "t is clamped at the end");
  const mid = E.catmullRom(pts, 1 / 3);
  near(mid.x, 100); near(mid.y, 50);
});

test("every entry path ends exactly at its target and the enemy lands there", () => {
  for (const wave of [5, 9, 10, 11]) {
    const g = gameWith(wave);
    const homes = new Map(g.drones.map((d) => [d, { ...d.home }]));
    for (const d of g.drones) {
      assert.deepEqual(E.catmullRom(d.entry.path, 1), homes.get(d), d.species + " path target");
    }
    const landed = new Set();
    for (let i = 0; i < 600 && landed.size < g.drones.length; i++) {
      E.updateEnemies(g, 0.02);
      for (const d of g.drones) {
        if (d.entry || landed.has(d)) continue;
        landed.add(d);
        assert.deepEqual({ x: d.x, y: d.y }, homes.get(d), d.species + " lands on its home");
      }
    }
    assert.equal(landed.size, g.drones.length, "every enemy finishes its entry");
  }
});

// ---- movement patterns ----

test("formation: the grid drones move sideways as one rigid block", () => {
  const g = BB.createGame({ rng: seeded() });
  assert.ok(g.drones.every((d) => d.pattern === "formation"));
  const before = g.drones.map((d) => ({ x: d.x, y: d.y }));
  BB.update(g, 0.1, {});
  const dx = g.drones[0].x - before[0].x;
  assert.ok(dx !== 0);
  g.drones.forEach((d, i) => { near(d.x - before[i].x, dx); near(d.y, before[i].y); });
});

test("sine: starts at home, swings 40 px sideways and keeps sinking", () => {
  const e = { home: { x: 200, y: 100 } };
  assert.deepEqual(E.TIMED.sine(e, 0), { x: 200, y: 100 });
  const q = E.TIMED.sine(e, 0.625); // a quarter period at 0.4 Hz
  near(q.x, 240); near(q.y, 100 + 22 * 0.625);
  near(E.TIMED.sine(e, 1.875).x, 160);
});

test("zigzag: a triangle wave of 55 px that starts at home", () => {
  const e = { home: { x: 200, y: 100 } };
  assert.deepEqual(E.TIMED.zigzag(e, 0), { x: 200, y: 100 });
  near(E.TIMED.zigzag(e, 0.5).x, 255);
  near(E.TIMED.zigzag(e, 1.5).x, 145);
  near(E.TIMED.zigzag(e, 2).x, 200);
  near(E.triangle(0.25), 1); near(E.triangle(0.75), -1); near(E.triangle(1), 0);
});

test("orbit: circles around its centre and starts at home", () => {
  const e = { orbit: { x: 208, y: 110 }, home: { x: 348, y: 110 } };
  assert.deepEqual(E.TIMED.orbit(e, 0), e.home);
  const top = E.TIMED.orbit(e, Math.PI / 2 / 0.9);
  near(top.x, 208); near(top.y, 160);
  const back = E.TIMED.orbit(e, (2 * Math.PI) / 0.9);
  near(back.x, 348); near(back.y, 110);
});

test("dive: hovers, then swoops past the ship and leaves the screen, inside the safe zone", () => {
  const g = BB.createGame({ rng: seeded() });
  g.drones = E.spawnEnemies(g, { groups: [{ species: "diver", count: 1 }] });
  const d = g.drones[0];
  let maxY = 0;
  for (let i = 0; i < 1000 && !d.dead; i++) {
    E.updateEnemies(g, 0.02);
    if (!d.entry) {
      assert.ok(d.x >= E.EDGE - 1e-9 && d.x + d.w <= BB.W - E.EDGE + 1e-9, "safe zone");
      maxY = Math.max(maxY, d.y);
    }
  }
  assert.ok(d.dead, "the diver leaves the screen");
  assert.ok(maxY > g.ship.y - 100, "it dives down to the ship's height");
});

test("dash: the mini-boss waits, then dashes between the two edge safe zones", () => {
  const g = BB.createGame({ rng: seeded() });
  g.drones = E.spawnEnemies(g, { groups: [{ species: "dasher", count: 1 }] });
  const d = g.drones[0];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 600; i++) { // 12 s
    E.updateEnemies(g, 0.02);
    if (d.entry) continue;
    lo = Math.min(lo, d.x); hi = Math.max(hi, d.x);
  }
  near(lo, E.EDGE);
  near(hi, BB.W - E.EDGE - d.w);
});

test("wander: a splitter drifts in random directions and stays in its box", () => {
  const g = BB.createGame({ rng: seeded(3) });
  g.drones = E.spawnEnemies(g, { groups: [{ species: "splitter", count: 1 }] });
  const d = g.drones[0];
  const headings = new Set();
  for (let i = 0; i < 1000; i++) {
    E.updateEnemies(g, 0.02);
    if (d.entry) continue;
    headings.add(Math.round(d.vx));
    assert.ok(d.x >= E.EDGE - 1e-9 && d.x + d.w <= BB.W - E.EDGE + 1e-9);
    assert.ok(d.y >= 40 - 1e-9 && d.y <= 300 + 1e-9);
  }
  assert.ok(headings.size > 5, "it keeps changing direction");
});

test("24 px edge safe zone holds for every species over a long run", () => {
  assert.equal(E.EDGE, 24);
  for (const wave of [9, 10, 11]) {
    const g = gameWith(wave);
    for (let i = 0; i < 1500; i++) {
      E.updateEnemies(g, 0.02);
      for (const d of g.drones) {
        if (d.entry || d.delay > 0 || d.dead) continue;
        assert.ok(d.x >= 24 - 1e-9 && d.x + d.w <= BB.W - 24 + 1e-9, `${d.species} at ${d.x}`);
      }
    }
  }
});

// ---- wave scripts ----

test("wave scripts 1-11 bring the species in design order", () => {
  const expected = {
    1: [], 2: ["wasp"], 3: ["viper"], 4: ["diver"], 5: ["orbiter"], 6: ["splitter"],
    7: ["viper", "wasp"], 8: ["diver", "splitter"], 9: ["diver", "splitter", "viper", "wasp"],
    10: ["dasher", "wasp"], 11: ["diver", "splitter", "viper", "wasp"],
  };
  for (let w = 1; w <= 11; w++) {
    const script = E.waveScript(w);
    assert.deepEqual(script.groups.map((x) => x.species).sort(), expected[w], "wave " + w);
    assert.equal(script.boss, w === 5 ? "orbiter" : w === 10 ? "dasher" : null);
    assert.equal(script.cycle, 0);
  }
});

test("playing through waves 1-11 spawns exactly what each script says", () => {
  const g = BB.createGame({ rng: seeded() });
  for (let w = 1; w <= 11; w++) {
    g.wave = w - 1; g.drones = [];
    BB.update(g, 0.001, {});
    assert.equal(g.wave, w);
    const script = E.waveScript(w);
    const extras = script.groups.reduce((n, x) => n + x.count, 0);
    assert.equal(g.drones.length, script.drones.cols * script.drones.rows + extras, "wave " + w);
    const want = ["drone", ...script.groups.map((x) => x.species)].sort();
    assert.deepEqual(speciesOf(g), [...new Set(want)].sort());
  }
});

test("wave 1 is still plain drones, and wave 2 has a bigger formation", () => {
  const a = E.waveScript(1), b = E.waveScript(2);
  assert.equal(a.groups.length, 0);
  assert.ok(b.drones.cols * b.drones.rows > a.drones.cols * a.drones.rows);
});

test("all five species and both mini-bosses appear somewhere in waves 1-11", () => {
  const seen = new Set(["drone"]);
  for (let w = 1; w <= 11; w++) for (const x of E.waveScript(w).groups) seen.add(x.species);
  for (const k of ["drone", "wasp", "viper", "diver", "splitter", "orbiter", "dasher"]) assert.ok(seen.has(k), k);
});

// ---- speed-up per cycle ----

test("each finished cycle of 11 waves makes the next one 20% faster", () => {
  assert.equal(E.speedMult(1), 1);
  assert.equal(E.speedMult(11), 1);
  near(E.speedMult(12), 1.2);
  near(E.speedMult(23), 1.4);
  assert.deepEqual(E.waveScript(12).groups, E.waveScript(1).groups);
  assert.deepEqual(E.waveScript(16).groups, E.waveScript(5).groups);
  assert.equal(E.waveScript(12).cycle, 1);
});

test("cycle 2 moves the formation and timed patterns faster than cycle 1", () => {
  const shift = (wave) => {
    const g = BB.createGame({ rng: seeded() });
    g.wave = wave; g.dir = 1;
    g.drones = [{ x: 100, y: 100, w: 28, h: 20 }];
    BB.update(g, 0.1, {});
    return g.drones[0].x - 100;
  };
  assert.ok(shift(12) > shift(1) * 1.2, "formation sweep is faster");

  const age = (wave) => {
    const g = BB.createGame({ rng: seeded() });
    g.wave = wave;
    const w = E.createEnemy(g, "wasp", 200, 100);
    w.home = { x: 200, y: 100 };
    g.drones = [w];
    E.updateEnemies(g, 1);
    return w.age;
  };
  near(age(1), 1);
  near(age(12), 1.2);
});

// ---- enemy fire ----

test("enemy fire rate rises with the wave and is capped", () => {
  assert.equal(E.fireRate(1), 0, "wave 1 is quiet");
  assert.ok(E.fireRate(2) > 0);
  for (let w = 2; w < 30; w++) assert.ok(E.fireRate(w + 1) >= E.fireRate(w), "never drops at wave " + w);
  assert.ok(E.fireRate(5) > E.fireRate(3));
  assert.ok(E.fireRate(100) <= 0.35 + 1e-9);
});

test("species arm their guns from the wave's rate: none in wave 1, divers never", () => {
  const g1 = BB.createGame({ rng: seeded() });
  assert.ok(g1.drones.every((d) => d.fireEvery === 0 && d.fireTimer === Infinity));
  const g = BB.createGame({ rng: seeded() });
  g.wave = 6;
  const wasp = E.createEnemy(g, "wasp", 0, 0);
  const drone = E.createEnemy(g, "drone", 0, 0);
  const diver = E.createEnemy(g, "diver", 0, 0);
  assert.ok(wasp.fireEvery > 0 && wasp.fireEvery < drone.fireEvery, "wasps shoot more than formation drones");
  assert.equal(diver.fireEvery, 0);
  g.wave = 3;
  assert.ok(E.createEnemy(g, "wasp", 0, 0).fireEvery > wasp.fireEvery, "later waves fire faster");
});

test("a ready shooter fires a bullet that falls, and it costs a life on the ship", () => {
  const g = BB.createGame({ rng: seeded() });
  g.wave = 3;
  const w = E.createEnemy(g, "wasp", 100, 100);
  w.home = { x: 100, y: 100 };
  w.fireTimer = 0;
  g.drones = [w];
  BB.update(g, 0.01, {});
  assert.equal(g.enemyBullets.length, 1);
  const y0 = g.enemyBullets[0].y;
  BB.update(g, 0.1, {});
  assert.ok(g.enemyBullets[0].y > y0, "falls");

  g.enemyBullets = [{ x: g.ship.x + 10, y: g.ship.y, w: 6, h: 10, vx: 0, vy: 0 }];
  BB.update(g, 0.001, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
  assert.equal(g.enemyBullets.length, 0);
});

test("the orbiter aims its shots at the ship and the dasher fires a three-way fan", () => {
  const g = gameWith(5);
  const orb = g.drones.find((d) => d.species === "orbiter");
  orb.entry = null; orb.delay = 0; orb.fireTimer = 0;
  E.updateEnemies(g, 0.001);
  assert.equal(g.enemyBullets.length, 1);
  assert.ok(g.enemyBullets[0].vy > 0);

  const g2 = gameWith(10);
  const dash = g2.drones.find((d) => d.species === "dasher");
  dash.entry = null; dash.delay = 0; dash.fireTimer = 0;
  E.updateEnemies(g2, 0.001);
  assert.equal(g2.enemyBullets.length, 3);
});

// ---- splitter ----

test("a splitter takes 3 hits, then splits into two small wanderers that do not split again", () => {
  const g = BB.createGame({ rng: seeded() });
  const s = E.createEnemy(g, "splitter", 200, 150);
  g.drones = [s];
  const shootAt = (t) => {
    g.bullets = [{ x: t.x + t.w / 2 - 2, y: t.y + 4, w: 4, h: 12 }];
    BB.update(g, 0.001, {});
  };
  shootAt(s); shootAt(s);
  assert.equal(g.drones.length, 1, "still alive after 2 hits");
  assert.equal(g.score, 0);
  shootAt(s);
  assert.equal(g.drones.length, 2);
  assert.ok(g.drones.every((d) => d.species === "splitling" && d.pattern === "wander"));
  assert.equal(g.score, 30);
  const [a] = g.drones;
  shootAt(a);
  assert.equal(g.drones.length, 1, "a splitling just dies");
  assert.equal(g.score, 35);
});

// ---- mini-bosses ----

test("mini-bosses have their HP, hold up under hits and always drop a capsule when they die", () => {
  assert.equal(E.BOSSES.orbiter.hp, 40);
  assert.equal(E.BOSSES.dasher.hp, 60);
  for (const [wave, species, hp] of [[5, "orbiter", 40], [10, "dasher", 60]]) {
    const g = BB.createGame({ rng: seeded() });
    g.wave = wave - 1; g.drones = [];
    BB.update(g, 0.001, {});
    const boss = g.drones.find((d) => d.species === species);
    assert.ok(boss && boss.boss);
    assert.equal(boss.hp, hp);

    parkAtHome(boss);
    const bystander = { x: 10, y: 200, w: 28, h: 20 }; // keeps the wave from ending when the boss dies
    g.drones = [boss, bystander];
    const shoot = () => {
      const c = boss.x + boss.w / 2;
      g.bullets = [{ x: c - 2, y: boss.y + 10, w: 4, h: 12 }];
      BB.update(g, 0.001, {});
    };
    shoot();
    assert.equal(boss.hp, hp - 1);
    assert.equal(g.capsules.length, 0, "no drop while alive");
    boss.hp = 1;
    const realRng = g.rng;
    g.rng = () => 0.5; // 0.5 >= 0.09: no drop
    shoot();
    assert.deepEqual(g.drones, [bystander]);
    assert.equal(g.capsules.length, 0, "no capsule on a roll of 0.5");
    assert.equal(g.score, boss.points);

    const g2 = BB.createGame({ rng: realRng });
    g2.wave = wave - 1; g2.drones = [];
    BB.update(g2, 0.001, {});
    const boss2 = g2.drones.find((d) => d.species === species);
    parkAtHome(boss2);
    g2.drones = [boss2, { x: 10, y: 200, w: 28, h: 20 }];
    boss2.hp = 1;
    g2.rng = () => 0.05; // below 0.09: capsule drops
    g2.bullets = [{ x: boss2.x + boss2.w / 2 - 2, y: boss2.y + 10, w: 4, h: 12 }];
    BB.update(g2, 0.001, {});
    assert.equal(g2.capsules.length, 1, "capsule from the boss on a roll of 0.05");
  }
});

test("the special shot hurts a mini-boss once per pass and kaboom only chips it", () => {
  const g = gameWith(5);
  const boss = g.drones.find((d) => d.boss);
  parkAtHome(boss);
  g.drones = [boss];
  const cx =boss.x + boss.w / 2;
  g.bullets = [{ x: cx - 20, y: boss.y + 10, w: 40, h: 16, pierce: true }];
  for (let i = 0; i < 3; i++) BB.update(g, 0.001, {});
  assert.equal(boss.hp, 40 - BB.PIERCE_DAMAGE);

  g.kaboomCharges = 1;
  assert.equal(BB.kaboom(g), true);
  parkAtHome(boss);
  for (let i = 0; i < 40 && g.nukes === 0; i++) { BB.update(g, 0.016, {}); parkAtHome(boss); }
  assert.equal(g.nukes, 1);
  assert.equal(boss.hp, 40 - BB.PIERCE_DAMAGE - 10);
  assert.equal(g.drones.length, 1, "the boss survives a kaboom");
});

test("touching a mini-boss costs one life, not a life per frame, and the boss stays", () => {
  const g = gameWith(10); // the dasher sits still while it waits, so it stays on the ship
  const boss = g.drones.find((d) => d.species === "dasher");
  boss.home = { x: g.ship.x - 10, y: g.ship.y - 10 };
  parkAtHome(boss);
  g.drones = [boss];
  for (let i = 0; i < 5; i++) BB.update(g, 0.016, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
  assert.equal(g.drones.length, 1);
});
