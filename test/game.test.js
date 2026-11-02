import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";

const BB = globalThis.BB;
const drone = (x, y) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h });

test("starts with score 0, full lives, wave 1 and a swarm", () => {
  const g = BB.createGame();
  assert.equal(g.score, 0);
  assert.equal(g.lives, BB.START_LIVES);
  assert.equal(g.wave, 1);
  assert.equal(g.status, "playing");
  assert.ok(g.drones.length > 0);
});

test("arrows move the ship and it stays on screen", () => {
  const g = BB.createGame();
  const x0 = g.ship.x;
  BB.update(g, 0.1, { right: true });
  assert.ok(g.ship.x > x0);
  BB.update(g, 100, { left: true });
  assert.equal(g.ship.x, 0);
  BB.update(g, 100, { right: true });
  assert.equal(g.ship.x, BB.W - g.ship.w);
});

test("shooting fires a bullet that rises, with a cooldown", () => {
  const g = BB.createGame();
  assert.equal(BB.shoot(g), true);
  assert.equal(g.bullets.length, 1);
  assert.equal(BB.shoot(g), false, "cooldown blocks a second shot");
  const y0 = g.bullets[0].y;
  BB.update(g, 0.1, {});
  assert.ok(g.bullets[0].y < y0);
  BB.update(g, 0.3, {});
  assert.equal(BB.shoot(g), true, "can fire again after cooldown");
});

test("holding fire shoots through update", () => {
  const g = BB.createGame();
  BB.update(g, 0.016, { fire: true });
  assert.equal(g.bullets.length, 1);
});

test("a bullet that hits a drone destroys both and scores", () => {
  const g = BB.createGame();
  g.drones = [drone(g.ship.x, 300), drone(100, 40)];
  g.dir = 0; // hold the swarm still so the shot lands deterministically
  BB.shoot(g);
  for (let i = 0; i < 60 && g.score === 0; i++) BB.update(g, 0.016, {});
  assert.equal(g.score, BB.DRONE.points);
  assert.equal(g.drones.length, 1);
  assert.equal(g.bullets.length, 0);
});

test("a bullet that misses leaves the screen and scores nothing", () => {
  const g = BB.createGame();
  g.drones = [drone(BB.W - BB.DRONE.w, 40)];
  BB.shoot(g);
  for (let i = 0; i < 100; i++) BB.update(g, 0.016, {});
  assert.equal(g.bullets.length, 0);
  assert.equal(g.score, 0);
});

test("a drone touching the ship costs a life, then brief invulnerability", () => {
  const g = BB.createGame();
  g.drones = [drone(g.ship.x, g.ship.y), drone(0, 40)];
  BB.update(g, 0.016, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
  assert.ok(g.invuln > 0);
  assert.equal(g.drones.length, 1);
});

test("a drone reaching the bottom costs a life", () => {
  const g = BB.createGame();
  g.drones = [drone(0, BB.H - BB.DRONE.h), drone(0, 40)];
  BB.update(g, 0.016, {});
  assert.equal(g.lives, BB.START_LIVES - 1);
});

test("losing every life is game over and freezes the game; restart resets it", () => {
  const g = BB.createGame();
  g.score = 70;
  g.lives = 1;
  g.drones = [drone(g.ship.x, g.ship.y)];
  BB.update(g, 0.016, {});
  assert.equal(g.lives, 0);
  assert.equal(g.status, "over");
  const x = g.ship.x;
  BB.update(g, 0.5, { right: true });
  assert.equal(g.ship.x, x, "frozen after game over");
  assert.equal(BB.shoot(g), false);
  const fresh = BB.restart();
  assert.equal(fresh.status, "playing");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.lives, BB.START_LIVES);
  assert.equal(fresh.wave, 1);
});

test("clearing the swarm starts a bigger next wave and keeps score and lives", () => {
  const g = BB.createGame();
  const first = g.drones.length;
  g.score = 10;
  g.drones = [drone(g.ship.x, 400)];
  g.dir = 0; // hold the swarm still so the shot lands deterministically
  BB.shoot(g);
  for (let i = 0; i < 60 && g.wave === 1; i++) BB.update(g, 0.016, {});
  assert.equal(g.wave, 2);
  assert.equal(g.score, 10 + BB.DRONE.points);
  assert.equal(g.lives, BB.START_LIVES);
  assert.ok(g.drones.length > first, "wave 2 has more drones");
  assert.equal(g.status, "playing");
});

test("drones sweep sideways and drop at the edge", () => {
  const g = BB.createGame();
  g.drones = [drone(BB.W - BB.DRONE.w - 1, 100)];
  const dir0 = g.dir;
  BB.update(g, 0.1, {});
  assert.equal(g.dir, -dir0);
  assert.ok(g.drones[0].y > 100);
});
