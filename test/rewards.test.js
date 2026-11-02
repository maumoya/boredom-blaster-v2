import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";

const BB = globalThis.BB;
const RW = globalThis.BBRewards;
const drone = (x, y) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h });
const onShip = (g) => ({ x: g.ship.x, y: g.ship.y });

// a game with one far-away drone so waves do not roll over and nothing touches the ship
function quietGame() {
  const g = BB.createGame();
  g.drones = [drone(0, 60)];
  return g;
}

test("weapon fires one shot per level, 1 to 5, and caps at 5", () => {
  for (let level = 1; level <= 5; level++) {
    const g = quietGame();
    g.weaponLevel = level;
    BB.shoot(g);
    assert.equal(g.bullets.length, level);
  }
  const g = quietGame();
  g.weaponLevel = 4;
  g.rng = () => 0; // every MASTERED / ULTRA-MAD roll succeeds
  for (let i = 0; i < 4; i++) { RW.applyCapsule(g, "bronze"); globalThis.BBSkills.choose(g, "more"); }
  assert.equal(g.weaponLevel, 7, "More shots goes on to MASTERED and ULTRA-MAD");
  assert.equal(g.bullets.length, 0);
});

test("losing a life drops the weapon one level, never below 1", () => {
  const g = quietGame();
  g.weaponLevel = 3;
  g.drones = [drone(g.ship.x, g.ship.y)];
  BB.update(g, 0.01, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
  assert.equal(g.weaponLevel, 2);
  g.weaponLevel = 1;
  g.invuln = 0;
  g.drones = [drone(g.ship.x, g.ship.y)];
  BB.update(g, 0.01, {});
  assert.equal(g.weaponLevel, 1);
});

function killDrones(g, n) {
  for (let i = 1; i <= n; i++) {
    g.drones = [drone(100, 100)];
    g.bullets = [{ x: 110, y: 100, w: 4, h: 12 }];
    BB.update(g, 0.001, {});
  }
}

test("a capsule drops on every 12th kill when the 9% roll succeeds", () => {
  const g = quietGame();
  g.rng = () => 0.089;
  for (let i = 1; i <= 24; i++) {
    killDrones(g, 1);
    assert.equal(g.capsules.length, Math.floor(i / 12), "after kill " + i);
  }
});

test("no capsule on the 12th kill when the roll is 0.09 or more", () => {
  const g = quietGame();
  g.rng = () => 0.09;
  killDrones(g, 24);
  assert.equal(g.capsules.length, 0);
});

test("a mini-boss drops a capsule only when the 9% roll succeeds", () => {
  const g = quietGame();
  const rolls = [0.089, 0.91]; // drop roll, then rank roll
  g.rng = () => rolls.shift();
  const c = RW.onMiniBossKill(g, 200, 100);
  assert.equal(g.capsules.length, 1);
  assert.equal(c.rank, "rainbow");
  g.rng = () => 0.09;
  assert.equal(RW.onMiniBossKill(g, 200, 100), null);
  assert.equal(g.capsules.length, 1);
});

test("rank rolls follow the odds and each rank gives its reward", () => {
  assert.equal(RW.rollRank(0), "bronze");
  assert.equal(RW.rollRank(0.6), "silver");
  assert.equal(RW.rollRank(0.85), "gold");
  assert.equal(RW.rollRank(0.91), "rainbow");
  assert.equal(RW.rollRank(0.99), "heart");
  assert.ok(Math.abs(Object.values(RW.RANK_ODDS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const g = quietGame();
  RW.applyCapsule(g, "bronze");
  assert.ok(g.picker, "bronze opens the picker");
  globalThis.BBSkills.choose(g, "more");
  assert.equal(g.weaponLevel, 2);
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, RW.SHIELD.hits);
  globalThis.BBSkills.choose(g, "larger");
  RW.applyCapsule(g, "gold");
  assert.equal(g.picks, 2);
  assert.equal(g.escorts.length, 0, "the escort capsule is retired");
  RW.applyCapsule(g, "rainbow");
  assert.equal(g.superStar, 8);
});

test("a falling capsule is caught by the ship and applied", () => {
  const g = quietGame();
  RW.spawnCapsule(g, g.ship.x + g.ship.w / 2, g.ship.y - 5, "silver");
  BB.update(g, 0.1, {});
  assert.equal(g.shield, RW.SHIELD.hits);
  assert.equal(g.capsules.length, 0);
  globalThis.BBSkills.choose(g, "more");
  RW.spawnCapsule(g, 10, BB.H - 1, "bronze");
  BB.update(g, 0.1, {});
  assert.equal(g.capsules.length, 0, "missed capsules fall off screen");
});

test("the shield absorbs hits, then a hit costs a life", () => {
  const g = quietGame();
  g.shield = 2;
  for (let i = 0; i < 3; i++) {
    g.invuln = 0;
    g.drones = [drone(g.ship.x, g.ship.y)];
    BB.update(g, 0.001, {});
  }
  assert.equal(g.shield, 0);
  assert.equal(g.lives, BB.START_LIVES - 1);
});

test("escorts: at most 2, each dies in one hit", () => {
  const g = quietGame();
  assert.equal(RW.addEscort(g), true);
  assert.equal(RW.addEscort(g), true);
  assert.equal(RW.addEscort(g), false);
  assert.equal(g.escorts.length, 2);
  g.drones = [drone(g.escorts[0].x, g.escorts[0].y)];
  BB.update(g, 0.001, {});
  assert.equal(g.escorts.length, 1);
  assert.equal(g.lives, BB.START_LIVES, "the ship is not hurt");
});

test("Super Star: 8 s of invincibility and triple fire rate, then it ends", () => {
  const g = quietGame();
  RW.applyCapsule(g, "rainbow");
  BB.shoot(g);
  assert.ok(Math.abs(g.cooldown - BB.BULLET.cooldown / 3) < 1e-9);
  g.drones = [drone(g.ship.x, g.ship.y)];
  BB.update(g, 0.001, {});
  assert.equal(g.lives, BB.START_LIVES, "invincible");
  for (let i = 0; i < 79; i++) BB.update(g, 0.1, {});
  assert.ok(g.superStar > 0);
  BB.update(g, 0.2, {});
  assert.equal(g.superStar, 0);
  g.drones = [drone(g.ship.x, g.ship.y)];
  BB.update(g, 0.001, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
  g.cooldown = 0;
  BB.shoot(g);
  assert.equal(g.cooldown, BB.BULLET.cooldown);
});

test("drops get rarer once a family is MASTERED, rarer still at ULTRA-MAD", () => {
  const g = quietGame();
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);
  close(RW.dropChance(g), 0.09);
  g.skills.faster = globalThis.BBSkills.MASTERED;
  close(RW.dropChance(g), 0.045);
  g.skills.laser = globalThis.BBSkills.ULTRA;
  close(RW.dropChance(g), 0.01125);
});
