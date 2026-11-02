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

test("reconcile: returns held ids that no active touch backs", () => {
  assert.deepEqual(IN.reconcile([1, 2], [2]), [1]);
  assert.deepEqual(IN.reconcile([], [5]), []);
  assert.deepEqual(IN.reconcile([3], [3]), []);
});

test("stick re-centres after 1.5 s of silence with no finger down", () => {
  const t = IN.createTouch(false);
  t.start(7, 100, 400, 0);
  t.move(7, 60, 360, 100);
  assert.ok(t.axes().x < 0);
  t.tick(1599, 0);
  assert.ok(t.axes().x < 0, "not yet");
  t.tick(1600, 1);
  assert.ok(t.axes().x < 0, "a finger still down keeps the stick, even held still");
  t.tick(1600, 0);
  assert.deepEqual(t.axes(), { x: 0, y: 0 });
});

test("a move restarts the idle clock", () => {
  const t = IN.createTouch(false);
  t.start(7, 100, 400, 0);
  t.move(7, 60, 360, 1000);
  t.tick(2400, 0);
  assert.ok(t.axes().x < 0);
});

test("pausing: releaseAll re-centres the stick", () => {
  const t = IN.createTouch(false);
  t.start(1, 100, 400, 0);
  t.move(1, 40, 340, 10);
  IN.releaseAll({ touch: t });
  assert.deepEqual(t.axes(), { x: 0, y: 0 });
  assert.deepEqual(t.heldIds(), []);
});

test("pause menu: Re-centre controls keeps the game paused", () => {
  const m = IN.createMenu({ screen: "playing" });
  m.toggle();
  const i = m.items().indexOf("Re-centre controls");
  assert.ok(i >= 0);
  assert.equal(m.activate(i), "recentre");
  assert.equal(m.screen, "pause");
});

test("iPhone case: touchend with no pointerup leaves the ship still", () => {
  const g = BB.createGame();
  const t = IN.createTouch(false);
  t.start(4, 120, 400, 0);
  t.move(4, 40, 300, 10);
  for (let i = 0; i < 5; i++) { const a = t.axes(); BB.update(g, 0.016, { mx: a.x, my: a.y }); }
  // touchend with an empty touches list: main.js lets go of every touch pointer
  t.releaseAll();
  const x0 = g.ship.x, y0 = g.ship.y;
  for (let i = 0; i < 60; i++) { const a = t.axes(); BB.update(g, 0.016, { mx: a.x, my: a.y }); }
  assert.equal(g.ship.x, x0);
  assert.equal(g.ship.y, y0);
});

test("a second thumb never lets go of the stick (pointer ids differ from touch ids)", () => {
  const t = IN.createTouch(false);
  t.start(2, 100, 400, 0); // pointerId 2, while Touch.identifier may be any number
  t.move(2, 40, 340, 10);
  t.tick(5000, 2); // two fingers down, stick held still for 5 s
  assert.ok(t.axes().x < 0);
});
