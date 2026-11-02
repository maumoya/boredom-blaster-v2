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

const BB = globalThis.BB, IN = globalThis.BBInput, K = globalThis.BBKeys, UI = globalThis.BBUI, RN = globalThis.BBRender;

function recorder() {
  const log = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { log.push({ fn: k, args, shadowBlur: t.shadowBlur }); return undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log };
}
const memory = (seed) => {
  const data = { ...seed };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ---- the controls zone ----
test("zone: the controls always float over the full-screen playfield; the Below switch is gone", () => {
  for (const [w, h] of [[390, 844], [390, 390 * 4 / 3 + 140], [1000, 700], [0, 0]]) assert.equal(IN.controlsZone(w, h), "overlay");
  assert.equal(IN.controlsZone(390, 844, true), "overlay");
  const m = IN.createMenu({ screen: "title" });
  m.openSettings(); m.section = "controls";
  assert.equal(m.settingsRows().findIndex((r) => r.name === "below"), -1);
});

test("zone: the layout puts the rings inside the zone below the playfield, for both hands", () => {
  const zoneH = IN.zoneHeightFor(390, 844);
  assert.ok(zoneH >= 130 && zoneH <= 260);
  for (const leftHanded of [false, true]) {
    const L = IN.layoutFor({ zone: "below", zoneH, leftHanded });
    assert.equal(L.zone, "below");
    for (const b of Object.values(L.buttons)) {
      assert.ok(b.y - b.r >= BB.H, "top inside the zone");
      assert.ok(b.y + b.r <= BB.H + zoneH, "bottom inside the zone");
      assert.ok(b.x - b.r >= 0 && b.x + b.r <= 480);
    }
  }
  const right = IN.layoutFor({ zone: "below", zoneH, leftHanded: false }), left = IN.layoutFor({ zone: "below", zoneH, leftHanded: true });
  assert.equal(left.buttons.fire.x, 480 - right.buttons.fire.x);
  assert.deepEqual(IN.layoutFor({ zone: "overlay" }).buttons, IN.BUTTONS);
});

// ---- hit boxes ----
test("hit boxes are 15 % larger than the drawn button", () => {
  const b = IN.BUTTONS.fire;
  assert.equal(IN.HIT_SCALE, 1.15);
  assert.equal(IN.buttonAt(b.x + b.r * 1.14, b.y), "fire");
  assert.equal(IN.buttonAt(b.x + b.r * 1.16, b.y), null);
  assert.equal(IN.buttonAt(b.x + b.r * 1.05, b.y), "fire", "a touch just outside the drawn ring still counts");
});

// ---- ring buttons ----
function ringDraw(opts) {
  const { ctx, log } = recorder();
  UI.createUI(ctx).ringButton(100, 100, 40, "fire", opts);
  return log;
}

test("ring button: no text labels in any state", () => {
  for (const state of ["idle", "pressed", "disabled"]) {
    const log = ringDraw({ state, color: "#4df", ready: true, time: 1, cooldown: 0.4, segments: { count: 1, total: 3 } });
    assert.equal(log.filter((c) => c.fn === "fillText" || c.fn === "strokeText").length, 0, state);
    assert.ok(log.some((c) => c.fn === "arc" && c.args[2] === 40), "the ring itself");
  }
});

test("ring button: pressed fills the ring, idle does not; colour bloom is on except when disabled", () => {
  const fills = (log) => log.filter((c) => c.fn === "fill").length;
  assert.ok(fills(ringDraw({ state: "pressed" })) > fills(ringDraw({ state: "idle" })));
  const blur = (log) => Math.max(...log.filter((c) => c.fn === "arc").map((c) => c.shadowBlur || 0));
  assert.ok(blur(ringDraw({ state: "idle" })) > 0);
  assert.equal(blur(ringDraw({ state: "disabled" })), 0);
});

test("ring button: ready pulse changes the bloom over time; a not-ready ring stays steady", () => {
  const blur = (opts) => Math.max(...ringDraw(opts).filter((c) => c.fn === "arc").map((c) => c.shadowBlur || 0));
  assert.notEqual(blur({ ready: true, time: 0 }), blur({ ready: true, time: 0.3 }));
  assert.equal(blur({ ready: false, time: 0 }), blur({ ready: false, time: 0.3 }));
});

test("ring button: cooldown arc follows the progress and disappears when full", () => {
  const arcs = (cooldown) => ringDraw({ cooldown }).filter((c) => c.fn === "arc" && c.args[2] === 48);
  const half = arcs(0.5);
  assert.ok(half.some((c) => Math.abs(c.args[4] - c.args[3] - Math.PI) < 1e-9), "half a turn");
  assert.equal(arcs(1).length, 0);
});

test("ring button: one arc segment per charge, lit ones brighter", () => {
  const segs = (count) => ringDraw({ segments: { count, total: 3 }, color: "#fd4" })
    .filter((c) => c.fn === "arc" && c.args[2] === 48 && c.args[4] - c.args[3] < Math.PI * 2 - 1e-9);
  assert.equal(segs(2).length, 3);
  assert.equal(segs(0).length, 3);
  assert.deepEqual(segs(2).map((c) => c.shadowBlur > 0), [true, true, false]);
});

test("controls draw rings in the zone with no text, and hide while a pad is connected", () => {
  const g = BB.createGame();
  g.kaboomCharges = 2; g.specialCooldown = 1;
  const touch = IN.createTouch(false);
  touch.setLayout(IN.layoutFor({ zone: "below", zoneH: 200, dpad: true }));
  const menu = IN.createMenu({ screen: "playing" });
  const drawIt = (extra) => {
    const rec = recorder();
    const r = RN.createRenderer(rec.ctx, null);
    r.draw({ game: g, menu, best: 0, touch, touchSeen: true, time: 1, ...extra });
    return rec.log;
  };
  const withTouch = drawIt({});
  const zoneText = withTouch.filter((c) => c.fn === "fillText" && c.args[2] > BB.H && c.args[2] < BB.H + 200 - IN.STRIP_H);
  assert.equal(zoneText.length, 0, "no labels");
  assert.ok(withTouch.some((c) => c.fn === "fillRect" && c.args[1] === BB.H && c.args[3] === 200), "zone background");
  const fireRing = (log) => log.some((c) => c.fn === "arc" && c.args[2] === touch.buttons().fire.r);
  assert.ok(fireRing(withTouch));
  assert.ok(!fireRing(drawIt({ padConnected: true })), "touch buttons hidden with a pad");
});

// ---- D-pad ----
test("D-pad: eight directions with diagonals, centre is neutral, outside is not a hit", () => {
  const d = { x: 100, y: 700, r: 60 };
  const v = (dx, dy) => IN.dpadVector(d, d.x + dx, d.y + dy);
  assert.deepEqual(v(0, 0), { x: 0, y: 0 });
  assert.deepEqual(v(40, 0), { x: 1, y: 0 });
  assert.deepEqual(v(-40, 0), { x: -1, y: 0 });
  assert.deepEqual(v(0, -40), { x: 0, y: -1 });
  assert.deepEqual(v(0, 40), { x: 0, y: 1 });
  const diag = v(35, -35);
  near(diag.x, Math.SQRT1_2); near(diag.y, -Math.SQRT1_2);
  near(Math.hypot(diag.x, diag.y), 1);
  assert.equal(v(200, 0), null);
});

test("D-pad: touch steers through it, a finger slid off stops, and no floating stick starts", () => {
  const touch = IN.createTouch(false);
  const L = IN.layoutFor({ zone: "below", zoneH: 200, dpad: true });
  touch.setLayout(L);
  const d = L.dpad;
  touch.start(1, d.x + 35, d.y + 35); // down-right
  near(touch.axes().x, Math.SQRT1_2); near(touch.axes().y, Math.SQRT1_2);
  touch.move(1, d.x - 40, d.y); // left
  assert.deepEqual(touch.axes(), { x: -1, y: 0 });
  touch.move(1, d.x + 500, d.y); // off the pad
  assert.deepEqual(touch.axes(), { x: 0, y: 0 });
  touch.end(1);
  touch.start(2, 60, 300); // the stick half, away from the pad
  assert.equal(touch.stick.state.active, false);
  // the buttons still work next to it
  touch.start(3, L.buttons.fire.x, L.buttons.fire.y);
  assert.equal(touch.fire(), true);
});

test("D-pad: off by default, saved in bb.controls, mirrored for left-handers", () => {
  assert.equal(IN.layoutFor({ zone: "below", zoneH: 200 }).dpad, null);
  const store = memory({});
  const c = K.createControls(store);
  assert.equal(c.get("dpad"), false);
  c.set("dpad", true);
  assert.equal(K.createControls(store).get("dpad"), true);
  const right = IN.layoutFor({ zone: "overlay", dpad: true }).dpad, left = IN.layoutFor({ zone: "overlay", dpad: true, leftHanded: true }).dpad;
  assert.equal(left.x, 480 - right.x);
});

// ---- Gamepad API ----
const pad = (over) => ({
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  ...over,
});
const press = (p, ...idx) => { for (const i of idx) p.buttons[i] = { pressed: true, value: 1 }; return p; };
const fakePads = (list) => ({ getPads: () => list });

test("gamepad: dead zone 0.2 on the stick, full tilt reaches 1", () => {
  const p = pad({ axes: [0.15, -0.19, 0, 0] });
  const gp = IN.createGamepad(fakePads([p]));
  assert.equal(gp.poll(), true);
  assert.deepEqual(gp.axes(), { x: 0, y: 0 });
  p.axes = [0.5, 0, 0, 0];
  gp.poll();
  assert.equal(gp.axes().x, 0.5);
  p.axes = [1, 1, 0, 0];
  gp.poll();
  near(Math.hypot(gp.axes().x, gp.axes().y), 1);
});

test("gamepad: the D-pad buttons steer too", () => {
  const p = press(pad(), 13, 14); // down + left
  const gp = IN.createGamepad(fakePads([p]));
  gp.poll();
  near(gp.axes().x, -Math.SQRT1_2); near(gp.axes().y, Math.SQRT1_2);
});

test("gamepad: A held is auto-fire", () => {
  const p = pad();
  const gp = IN.createGamepad(fakePads([p]));
  gp.poll();
  assert.equal(gp.fire(), false);
  press(p, 0);
  gp.poll();
  assert.equal(gp.fire(), true);
  gp.poll();
  assert.equal(gp.fire(), true, "stays on while held");
});

test("gamepad: X special, B kaboom, Y mute, Menu pause, R1 special; each fires once per press", () => {
  const p = pad();
  const gp = IN.createGamepad(fakePads([p]));
  gp.poll();
  press(p, 2, 1, 3, 9);
  gp.poll();
  assert.deepEqual(gp.takePressed(), { special: true, kaboom: true, pause: true, mute: true });
  gp.poll(); // still held: no new press
  assert.deepEqual(gp.takePressed(), { special: false, kaboom: false, pause: false, mute: false });
  const q = press(pad(), 5);
  const gq = IN.createGamepad(fakePads([q]));
  gq.poll();
  assert.equal(gq.takePressed().special, true, "R1");
});

test("gamepad: menu steps come from the stick and A", () => {
  const p = pad();
  const gp = IN.createGamepad(fakePads([p]));
  gp.poll();
  p.axes = [0, 0.9, 0, 0];
  gp.poll();
  assert.equal(gp.takeNav().down, true);
  gp.poll();
  assert.equal(gp.takeNav().down, false, "held stick steps once");
  press(p, 0);
  gp.poll();
  assert.equal(gp.takeNav().confirm, true);
});

test("gamepad: no throw when the API is missing, throws, or the pad leaves", () => {
  const saved = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    const gp = IN.createGamepad();
    assert.equal(gp.poll(), false);
    assert.equal(gp.connected(), false);
    assert.deepEqual(gp.axes(), { x: 0, y: 0 });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    assert.equal(IN.createGamepad().poll(), false, "no getGamepads");
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
  }
  assert.equal(IN.createGamepad({ getPads: () => { throw new Error("blocked"); } }).poll(), false);
  assert.equal(IN.createGamepad({ getPads: () => [null, null] }).poll(), false);
  let list = [press(pad(), 0)];
  const gp = IN.createGamepad({ getPads: () => list });
  gp.poll();
  assert.equal(gp.fire(), true);
  list = [null];
  gp.poll();
  assert.equal(gp.connected(), false);
  assert.equal(gp.fire(), false, "unplugging stops the fire");
});

test("gamepad: a fake navigator.getGamepads is used by default", () => {
  const saved = globalThis.navigator;
  try {
    Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => [press(pad(), 0)] }, configurable: true });
    const gp = IN.createGamepad();
    assert.equal(gp.poll(), true);
    assert.equal(gp.fire(), true);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
  }
});

// ---- remapping, saved in bb.pad ----
test("pad remap: rebinding is saved in bb.pad and reloaded; a taken button swaps over", () => {
  const store = memory({});
  const map = K.createPad(store);
  assert.deepEqual(map.all(), { fire: 0, kaboom: 1, special: 2, mute: 3, pause: 9 });
  assert.equal(map.rebind("fire", 7), true);
  assert.equal(map.rebind("kaboom", 7), true);
  assert.equal(map.get("fire"), 1, "swapped");
  assert.equal(map.get("kaboom"), 7);
  assert.deepEqual(JSON.parse(store.data["bb.pad"]), map.all());
  assert.deepEqual(K.createPad(store).all(), map.all());
  map.reset();
  assert.deepEqual(K.createPad(store).all(), K.PAD_DEFAULTS);
});

test("pad remap: R1, unknown actions and bad buttons are refused; a broken store gives the defaults", () => {
  const map = K.createPad(null);
  assert.equal(map.rebind("fire", 5), false);
  assert.equal(map.rebind("jump", 3), false);
  assert.equal(map.rebind("fire", -1), false);
  assert.equal(map.rebind("fire", 99), false);
  assert.equal(map.rebind("fire", 1.5), false);
  for (const bad of ["{", "[]", '{"fire":5}', '{"fire":3,"mute":3}', "null"]) {
    assert.deepEqual(K.createPad(memory({ "bb.pad": bad })).all(), K.PAD_DEFAULTS, bad);
  }
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => K.createPad(broken).rebind("fire", 8));
});

test("pad remap: a remapped pad drives the game, and the Settings row walks through the actions", () => {
  const store = memory({});
  const map = K.createPad(store);
  map.rebind("fire", 4); // LB fires now
  const p = press(pad(), 4);
  const gp = IN.createGamepad({ getPads: () => [p], pad: map });
  gp.poll();
  assert.equal(gp.fire(), true);

  const m = IN.createMenu({ screen: "title", pad: map });
  m.openSettings(); m.section = "controls";
  const i = m.settingsRows().findIndex((r) => r.type === "padmap");
  assert.equal(m.activate(i), "padmap");
  assert.equal(m.padCapturing, 0);
  assert.match(m.settingsRows()[i].value, /^press /);
  const buttons = [10, 11, 6, 7, 8]; // one per action in order
  const results = buttons.map((b) => m.padCapture(b));
  assert.deepEqual(results, ["bound", "bound", "bound", "bound", "done"]);
  assert.equal(m.padCapturing, null);
  assert.deepEqual(K.PAD_ACTIONS.map((a) => map.get(a)), buttons);
  assert.deepEqual(K.createPad(store).all(), map.all(), "saved in bb.pad");
  assert.equal(m.padCapture(3), null, "nothing waiting");
});

test("settings: the new rows fit on screen and Reset keys also resets the pad", () => {
  const m = IN.createMenu({ screen: "title" });
  m.pad.rebind("fire", 8);
  m.openSettings(); m.section = "controls";
  const rows = m.settingsRows(), L = IN.SETTINGS_LAYOUT;
  assert.ok(L.y + rows.length * (L.h + L.gap) <= BB.H);
  assert.equal(rows[rows.length - 1].type, "back");
  m.activate(rows.findIndex((r) => r.type === "reset"));
  assert.equal(m.pad.get("fire"), 0);
});
