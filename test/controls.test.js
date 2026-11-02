import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";

const BB = globalThis.BB;
const IN = globalThis.BBInput;
const drone = (x, y) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("joystick: inside the dead zone outputs zero", () => {
  const j = IN.createJoystick();
  j.start(1, 100, 400);
  j.move(1, 100 + IN.STICK.dead - 1, 400);
  assert.deepEqual([j.state.x, j.state.y], [0, 0]);
  j.move(1, 100 + IN.STICK.dead + 10, 400);
  assert.ok(j.state.x > 0);
});

test("joystick: knob is clamped to 60 px and output reaches 1", () => {
  const j = IN.createJoystick();
  j.start(1, 100, 400);
  j.move(1, 300, 400);
  near(Math.hypot(j.state.kx - j.state.cx, j.state.ky - j.state.cy), 60);
  near(j.state.x, 1);
  near(j.state.y, 0);
});

test("joystick: center trails a finger dragged past the clamp", () => {
  const j = IN.createJoystick();
  j.start(1, 100, 400);
  j.move(1, 300, 400);
  near(j.state.cx, 240);
  j.move(1, 240, 400); // back to the trailed center: neutral
  assert.deepEqual([j.state.x, j.state.y], [0, 0]);
});

test("joystick: 2D output and release", () => {
  const j = IN.createJoystick();
  j.start(1, 100, 400);
  j.move(1, 130, 430);
  near(j.state.x, 0.5);
  near(j.state.y, 0.5);
  j.end(1);
  assert.deepEqual([j.state.x, j.state.y, j.state.active], [0, 0, false]);
});

test("multi-touch: left thumb steers while right thumb holds FIRE", () => {
  const t = IN.createTouch();
  t.start(1, 100, 400);
  t.start(2, IN.BUTTONS.fire.x, IN.BUTTONS.fire.y);
  t.move(1, 140, 400);
  assert.ok(t.axes().x > 0);
  assert.equal(t.fire(), true);
  t.end(2);
  assert.equal(t.fire(), false);
  assert.ok(t.axes().x > 0, "stick unaffected by right thumb release");
  t.end(1);
  assert.deepEqual(t.axes(), { x: 0, y: 0 });
});

test("multi-touch: a second left touch does not steal the stick; right half never steers", () => {
  const t = IN.createTouch();
  t.start(1, 100, 400);
  t.start(2, 50, 500);
  t.move(2, 150, 500);
  assert.deepEqual(t.axes(), { x: 0, y: 0 });
  t.start(3, 300, 300); // right half, no button
  t.move(3, 400, 300);
  assert.deepEqual(t.axes(), { x: 0, y: 0 });
});

test("touch buttons: special and kaboom register one press each", () => {
  const t = IN.createTouch();
  t.start(5, IN.BUTTONS.special.x, IN.BUTTONS.special.y);
  t.start(6, IN.BUTTONS.kaboom.x, IN.BUTTONS.kaboom.y);
  assert.deepEqual(t.takePressed(), { special: true, kaboom: true });
  assert.deepEqual(t.takePressed(), { special: false, kaboom: false });
});

test("keyboard: arrows/WASD give 2D movement, diagonals normalized", () => {
  const k = IN.createKeyboard();
  k.keydown("ArrowLeft");
  k.keydown("KeyW");
  const a = k.axes();
  near(Math.hypot(a.x, a.y), 1);
  assert.ok(a.x < 0 && a.y < 0);
  k.keyup("ArrowLeft"); k.keyup("KeyW");
  k.keydown("KeyD"); k.keydown("KeyS");
  assert.ok(k.axes().x > 0 && k.axes().y > 0);
  k.keydown("Space");
  assert.equal(k.fire(), true);
  k.keyup("Space");
  assert.equal(k.fire(), false);
});

test("keyboard: special, kaboom, pause and mute are one-shot presses on the default keys", () => {
  const k = IN.createKeyboard();
  k.keydown("KeyI"); k.keydown("KeyJ"); k.keydown("KeyP"); k.keydown("KeyM");
  assert.deepEqual(k.takePressed(), { special: true, kaboom: true, pause: true, mute: true });
  assert.deepEqual(k.takePressed(), { special: false, kaboom: false, pause: false, mute: false });
  k.keydown("Escape");
  assert.equal(k.takePressed().pause, true, "Escape always pauses");
});

test("keyboard: the old X and B keys no longer act, and a rebound key follows the bindings", () => {
  const keys = globalThis.BBKeys.createKeys(null);
  const k = IN.createKeyboard(keys);
  assert.equal(k.keydown("KeyX"), false);
  keys.rebind("fire", "KeyF");
  k.keydown("KeyF");
  assert.equal(k.fire(), true);
  k.keyup("KeyF");
  assert.equal(k.fire(), false);
  assert.equal(k.keydown("Space"), false, "the old fire key is free now");
  k.keydown("ArrowLeft");
  assert.ok(k.axes().x < 0, "arrows still steer");
  k.releaseAll();
  assert.equal(k.axes().x, 0);
});

test("ship goes anywhere below the top bar to the bottom edge, never off screen", () => {
  const g = BB.createGame();
  g.drones = [drone(0, 40)]; g.dir = 0;
  BB.update(g, 100, { up: true });
  assert.equal(g.ship.y, BB.HUD_H, "top of the playfield");
  assert.equal(BB.SHIP_MIN_Y, BB.HUD_H);
  BB.update(g, 100, { down: true });
  assert.equal(g.ship.y, BB.H - g.ship.h, "bottom edge of the screen");
  assert.equal(g.ship.y + g.ship.h, BB.H);
  const x0 = g.ship.x, y0 = g.ship.y;
  BB.update(g, 0.1, { mx: -0.5, my: -0.5 });
  assert.ok(g.ship.x < x0 && g.ship.y < y0);
  BB.update(g, 100, { mx: 1, my: 0 });
  assert.equal(g.ship.x, BB.W - g.ship.w);
});

test("special shot: piercing, 6 s cooldown", () => {
  const g = BB.createGame();
  g.drones = [drone(g.ship.x, 300), drone(g.ship.x, 200), drone(0, 40)];
  g.dir = 0;
  assert.equal(BB.special(g), true);
  assert.equal(BB.special(g), false);
  for (let i = 0; i < 60; i++) BB.update(g, 0.016, {});
  assert.equal(g.drones.length, 1, "one shot pierced both drones");
  assert.equal(g.score, 2 * BB.DRONE.points);
  BB.update(g, 4.9, {});
  assert.equal(BB.special(g), false, "still reloading before 6 s");
  BB.update(g, 1.2, {});
  assert.equal(BB.special(g), true);
});

test("kaboom: one charge per 18 kills, max 3, and 5 nearest drones die", () => {
  const g = BB.createGame({ rng: () => 0.99 }); // no capsule drops, so no random extra kills
  for (let i = 0; i < 18; i++) {
    g.drones = [drone(g.ship.x, 300), drone(0, 40)];
    g.dir = 0; g.cooldown = 0;
    BB.shoot(g);
    for (let n = 0; n < 60 && g.drones.length > 1; n++) BB.update(g, 0.016, {});
  }
  assert.equal(g.kills, 18);
  assert.equal(g.kaboomCharges, 1);
  g.kills = 53; g.kaboomCharges = 2;
  g.drones = [drone(g.ship.x, 300), drone(0, 40)]; g.dir = 0; g.cooldown = 0;
  BB.shoot(g);
  for (let n = 0; n < 60 && g.drones.length > 1; n++) BB.update(g, 0.016, {});
  assert.equal(g.kaboomCharges, 3);
  g.kills = 71;
  g.drones = [drone(g.ship.x, 300), drone(0, 40)]; g.dir = 0; g.cooldown = 0;
  BB.shoot(g);
  for (let n = 0; n < 60 && g.drones.length > 1; n++) BB.update(g, 0.016, {});
  assert.equal(g.kaboomCharges, 3, "capped at 3");

  // a cluster of 5 and one far-off drone: the missile goes to the cluster and the blast kills only it
  const lone = drone(440, 60);
  const cluster = [0, 1, 2, 3, 4].map((i) => drone(60 + i * 20, 300 + (i % 2) * 20));
  g.drones = [lone, ...cluster];
  g.dir = 0;
  const score = g.score;
  assert.equal(BB.kaboom(g), true);
  assert.equal(g.kaboomCharges, 2);
  assert.equal(g.drones.length, 6, "nothing dies while the missile flies");
  for (let n = 0; n < 40 && g.nukes === 0; n++) BB.update(g, 0.016, {});
  assert.deepEqual(g.drones, [lone]);
  assert.equal(g.score, score + 5 * BB.DRONE.points);
});

test("kaboom without a charge does nothing", () => {
  const g = BB.createGame();
  const n = g.drones.length;
  assert.equal(BB.kaboom(g), false);
  assert.equal(g.drones.length, n);
});

test("pause freezes everything; toggling resumes", () => {
  const g = BB.createGame();
  assert.equal(BB.togglePause(g), true);
  const x = g.ship.x, dx = g.drones[0].x;
  BB.update(g, 1, { right: true, fire: true });
  assert.equal(g.ship.x, x);
  assert.equal(g.drones[0].x, dx);
  assert.equal(g.bullets.length, 0);
  assert.equal(BB.special(g), false);
  assert.equal(BB.togglePause(g), false);
  BB.update(g, 0.1, { right: true });
  assert.ok(g.ship.x > x);
});

test("formation shift never overlaps or clips at the edges", () => {
  for (let wave = 1; wave <= 6; wave++) {
    const g = BB.createGame();
    g.wave = wave;
    g.drones = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) g.drones.push(drone(40 + c * BB.DRONE.gapX, 50 + r * BB.DRONE.gapY));
    const gaps = g.drones.map((d) => d.x - g.drones[0].x);
    for (let i = 0; i < 400 && g.status === "playing"; i++) {
      BB.update(g, 0.016, {});
      if (g.drones.length < 24) break;
      for (const d of g.drones) assert.ok(d.x >= 0 && d.x + d.w <= BB.W, "inside the screen");
      g.drones.forEach((d, k) => near(d.x - g.drones[0].x, gaps[k], 1e-6));
    }
  }
});
