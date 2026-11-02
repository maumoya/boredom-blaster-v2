import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";

const BB = globalThis.BB;
const E = globalThis.BBEnemies;
function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test("each world restarts the wave ramp and is 10 % faster than the last", () => {
  assert.equal(E.waveInWorld(1), 1);
  assert.equal(E.waveInWorld(100), 100);
  assert.equal(E.waveInWorld(101), 1);
  assert.equal(E.worldIndex(100), 0);
  assert.equal(E.worldIndex(101), 1);
  assert.equal(E.cycleOf(101), 0);
  assert.ok(Math.abs(E.speedMult(101) - 1.1) < 1e-9);
  assert.ok(E.speedMult(99) > E.speedMult(101), "monster speed drops back at a new world");
  assert.equal(E.fireRate(101), 0, "a new world's first wave is quiet again");
  assert.deepEqual(E.waveScript(112).groups, E.waveScript(12).groups);
});

test("wave 100 of each world is the world boss, tougher each world", () => {
  const s1 = E.waveScript(100), s2 = E.waveScript(200);
  assert.ok(s1.worldBoss && s2.worldBoss);
  assert.ok(!E.waveScript(99).worldBoss);
  const g1 = BB.createGame({ rng: seeded(), wave: 100 }), g2 = BB.createGame({ rng: seeded(), wave: 200 });
  const hp = (g) => g.drones.filter((d) => d.worldBoss).map((d) => d.maxHp);
  assert.deepEqual(hp(g1), [80, 120]);
  assert.deepEqual(hp(g2), [120, 180]);
});

test("clearing wave 100 starts a new world: skills and tools reset, score and lives carry on", () => {
  const g = BB.createGame({ rng: seeded(), wave: 100 });
  g.score = 12345; g.lives = 4; g.skills.more = 5; g.kaboomCharges = 3; g.shield = 2;
  g.drones = [];
  BB.update(g, 0.016, {});
  assert.equal(g.wave, 101);
  assert.equal(g.score, 12345);
  assert.equal(g.lives, 4);
  assert.equal(g.skills.more, 1);
  assert.equal(g.kaboomCharges, 0);
  assert.equal(g.shield, 0);
  assert.equal(g.worldsCleared, 1);
});

test("between worlds a warp plays (stamp, fly-out, route map, fade) and then the next wave spawns", () => {
  const g = BB.createGame({ rng: seeded(), wave: 100 });
  const boss = g.drones.find((d) => d.worldBoss);
  g.drones = [boss];
  for (let i = 0; i < 80; i++) BB.update(g, 0.05, {}); // let the boss fly in
  boss.hp = 1;
  g.invuln = 99;
  g.bullets = [{ x: boss.x + boss.w / 2, y: boss.y + boss.h / 2, w: 4, h: 10 }];
  BB.update(g, 0.001, {});
  assert.equal(g.wave, 101);
  assert.ok(g.warp, "the warp runs");
  assert.equal(g.drones.length, 0, "no enemies during the warp");
  assert.ok(Math.abs(g.warp.x - (boss.x + boss.w / 2)) < 30, "the stamp lands on the boss");
  assert.deepEqual([g.warp.from, g.warp.to], [0, 1]);
  assert.equal(BB.warpPhase(0.1).name, "stamp");
  assert.equal(BB.warpPhase(BB.WARP.stamp + 0.1).name, "fly");
  assert.equal(BB.warpPhase(BB.WARP.stamp + BB.WARP.fly + 0.1).name, "map");
  const y0 = g.ship.y;
  for (let t = 0; t < BB.WARP.stamp + BB.WARP.fly * 0.9; t += 0.05) BB.update(g, 0.05, {});
  assert.ok(g.ship.y < y0 - 100, "the ship flies out the top");
  for (let t = 0; t < BB.WARP.total; t += 0.05) BB.update(g, 0.05, {});
  assert.equal(g.warp, null);
  assert.equal(g.ship.y, BB.SHIP.y);
  assert.ok(g.drones.length > 0, "world 2 wave 1 spawned");
});

test("debris falls only from world 2 on, breaks on shots and hurts the ship", () => {
  assert.equal(BB.debrisRate(50), 0);
  assert.ok(BB.debrisRate(150) > 0 && BB.debrisRate(450) > BB.debrisRate(150));
  const g = BB.createGame({ rng: seeded(), wave: 150 });
  let seen = 0;
  for (let i = 0; i < 60; i++) { BB.stepDebris(g, 0.1); seen = Math.max(seen, g.debris.length); }
  assert.ok(seen > 0);
  g.debris = [{ x: 100, y: 200, w: 20, h: 20, hp: 1, vx: 0, vy: 0, spin: 0 }];
  g.debrisClock = 0;
  g.bullets = [{ x: 105, y: 205, w: 4, h: 10 }];
  const before = g.score;
  BB.stepDebris(g, 0.001);
  assert.equal(g.debris.length, 0);
  assert.ok(g.score > before);
  g.debris = [{ x: g.ship.x, y: g.ship.y, w: 20, h: 20, hp: 1, vx: 0, vy: 0, spin: 0 }];
  g.invuln = 0; g.shield = 0;
  const lives = g.lives;
  BB.stepDebris(g, 0.001);
  assert.equal(g.lives, lives - 1);
});
