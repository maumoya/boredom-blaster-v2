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

const BB = globalThis.BB, K = globalThis.BBKeys, IN = globalThis.BBInput, RN = globalThis.BBRender, RW = globalThis.BBRewards;
const drone = (x, y) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h });

// in-memory localStorage
function memory(initial) {
  const data = { ...(initial || {}) };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}
const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

function recorder() {
  const log = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { log.push({ fn: k, args, alpha: t.globalAlpha }); return undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log };
}

// ---- free movement ----
test("ship reaches the top of the playfield and the bottom edge but never leaves the screen", () => {
  const g = BB.createGame();
  g.drones = [drone(0, 40)]; g.dir = 0;
  BB.update(g, 100, { up: true });
  assert.equal(g.ship.y, BB.HUD_H);
  BB.update(g, 100, { down: true });
  assert.equal(g.ship.y + g.ship.h, BB.H);
  BB.update(g, 100, { mx: -1, my: 1 });
  assert.equal(g.ship.x, 0);
  BB.update(g, 100, { mx: 1, my: 1 });
  assert.equal(g.ship.x + g.ship.w, BB.W);
  assert.ok(g.ship.y >= 0 && g.ship.y + g.ship.h <= BB.H);
});

test("no tray background is drawn and the buttons float at 40 % opacity", () => {
  const { ctx, log } = recorder();
  const r = RN.createRenderer(ctx, null);
  const g = BB.createGame();
  const menu = IN.createMenu({ screen: "playing" });
  r.draw({ game: g, menu, best: 0, touch: IN.createTouch(), touchSeen: true, time: 1 });
  // the old tray was a full-width panel starting at y = 520
  const trayRects = log.filter((c) => c.fn === "arcTo" && c.args[0] >= 480 && c.args[1] >= 520);
  assert.deepEqual(trayRects, []);
  const b = IN.BUTTONS.fire;
  const fireArcs = log.filter((c) => c.fn === "arc" && c.args[0] === b.x && c.args[2] === b.r);
  assert.ok(fireArcs.length > 0);
  for (const c of fireArcs) assert.equal(c.alpha, 0.4);
});

// ---- capsules ----
test("the heart capsule adds a life, up to 9", () => {
  const g = BB.createGame();
  g.drones = [drone(0, 60)];
  assert.ok(RW.RANKS.includes("heart"));
  RW.applyCapsule(g, "heart");
  assert.equal(g.lives, BB.START_LIVES + 1);
  g.lives = 8;
  RW.applyCapsule(g, "heart");
  assert.equal(g.lives, 9);
  RW.applyCapsule(g, "heart");
  assert.equal(g.lives, 9, "capped at 9");
  assert.equal(BB.MAX_LIVES, 9);
});

test("a caught heart capsule gives the life in play", () => {
  const g = BB.createGame();
  g.drones = [drone(0, 60)];
  RW.spawnCapsule(g, g.ship.x + g.ship.w / 2, g.ship.y - 5, "heart");
  BB.update(g, 0.1, {});
  assert.equal(g.lives, BB.START_LIVES + 1);
  assert.equal(g.capsules.length, 0);
});

test("shield capsules stack 3 hits each, up to 9", () => {
  const g = BB.createGame();
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 3);
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 6);
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 9);
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 9, "capped at 9");
  g.shield = 8;
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 9);
});

test("the heart capsule and a 9-hit shield draw without errors", () => {
  const { ctx } = recorder();
  const r = RN.createRenderer(ctx, null);
  const g = BB.createGame();
  g.shield = 9; g.lives = 9;
  RW.spawnCapsule(g, 100, 200, "heart");
  r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: null, time: 1 });
});

// ---- keys.js ----
test("keys: defaults are W A S D, Space, I, J, P, M and the arrows and Escape always work", () => {
  const keys = K.createKeys(null);
  assert.equal(keys.actionFor("KeyW"), "up");
  assert.equal(keys.actionFor("KeyA"), "left");
  assert.equal(keys.actionFor("KeyS"), "down");
  assert.equal(keys.actionFor("KeyD"), "right");
  assert.equal(keys.actionFor("Space"), "fire");
  assert.equal(keys.actionFor("KeyI"), "special");
  assert.equal(keys.actionFor("KeyJ"), "kaboom");
  assert.equal(keys.actionFor("KeyP"), "pause");
  assert.equal(keys.actionFor("KeyM"), "mute");
  assert.equal(keys.actionFor("ArrowUp"), "up");
  assert.equal(keys.actionFor("ArrowLeft"), "left");
  assert.equal(keys.actionFor("ArrowDown"), "down");
  assert.equal(keys.actionFor("ArrowRight"), "right");
  assert.equal(keys.actionFor("Escape"), "pause");
  assert.equal(keys.actionFor("KeyQ"), null);
  assert.equal(keys.label("fire"), "SPACE");
  assert.equal(keys.label("up"), "W");
});

test("keys: rebinding moves the action, frees the old key and saves to bb.keys", () => {
  const store = memory();
  const keys = K.createKeys(store);
  assert.equal(keys.rebind("special", "KeyX"), true);
  assert.equal(keys.actionFor("KeyX"), "special");
  assert.equal(keys.actionFor("KeyI"), null);
  assert.equal(JSON.parse(store.data["bb.keys"]).special, "KeyX");
});

test("keys: rebinding to a key another action holds swaps the two", () => {
  const keys = K.createKeys(null);
  assert.equal(keys.rebind("fire", "KeyW"), true);
  assert.equal(keys.get("fire"), "KeyW");
  assert.equal(keys.get("up"), "Space", "up takes fire's old key");
  assert.equal(keys.actionFor("Space"), "up");
  assert.equal(new Set(K.ACTIONS.map((a) => keys.get(a))).size, K.ACTIONS.length, "no key is bound twice");
});

test("keys: arrows, Escape and unknown actions cannot be bound", () => {
  const keys = K.createKeys(null);
  assert.equal(keys.rebind("fire", "ArrowUp"), false);
  assert.equal(keys.rebind("fire", "Escape"), false);
  assert.equal(keys.rebind("jump", "KeyZ"), false);
  assert.equal(keys.rebind("fire", ""), false);
  assert.equal(keys.get("fire"), "Space");
});

test("keys: reset restores the defaults and saves them", () => {
  const store = memory();
  const keys = K.createKeys(store);
  keys.rebind("fire", "KeyF"); keys.rebind("up", "KeyZ");
  keys.reset();
  assert.deepEqual(keys.all(), K.DEFAULTS);
  assert.deepEqual(JSON.parse(store.data["bb.keys"]), K.DEFAULTS);
});

test("keys: saved bindings load in a new session", () => {
  const store = memory();
  K.createKeys(store).rebind("kaboom", "KeyK");
  const again = K.createKeys(store);
  assert.equal(again.get("kaboom"), "KeyK");
  assert.equal(again.get("special"), "KeyI");
});

test("keys: a broken or nonsense store never throws and gives the defaults", () => {
  assert.deepEqual(K.createKeys(broken).all(), K.DEFAULTS);
  assert.deepEqual(K.createKeys(null).all(), K.DEFAULTS);
  for (const bad of ["not json", "[1,2]", "42", "null", '{"fire":5}', '{"fire":"KeyW"}', '{"fire":"ArrowUp"}']) {
    assert.deepEqual(K.createKeys(memory({ "bb.keys": bad })).all(), K.DEFAULTS, bad);
  }
  assert.doesNotThrow(() => K.createKeys(broken).rebind("fire", "KeyF"));
  assert.doesNotThrow(() => K.createKeys(broken).reset());
});

// ---- settings switches ----
test("settings: Music, Sounds and Vibration start on, toggle and save to bb.settings", () => {
  const store = memory();
  const s = K.createSettings(store);
  assert.deepEqual(s.all(), { music: true, sounds: true, vibration: true });
  assert.equal(s.toggle("music"), false);
  s.set("vibration", false);
  assert.deepEqual(JSON.parse(store.data["bb.settings"]), { music: false, sounds: true, vibration: false });
  assert.deepEqual(K.createSettings(store).all(), { music: false, sounds: true, vibration: false });
  assert.equal(s.set("nope", true), false);
});

test("settings: a broken store never throws", () => {
  assert.deepEqual(K.createSettings(broken).all(), K.SETTINGS_DEFAULTS);
  assert.doesNotThrow(() => K.createSettings(broken).set("music", false));
  for (const bad of ["{", "[]", "7", '{"music":"no"}']) {
    assert.deepEqual(K.createSettings(memory({ "bb.settings": bad })).all(), K.SETTINGS_DEFAULTS, bad);
  }
  assert.equal(K.createSettings(memory({ "bb.settings": '{"sounds":false}' })).get("sounds"), false);
});

// ---- the SETTINGS screen ----
test("settings screen: opens from the title and pause screens by the gear and returns where it came from", () => {
  const m = IN.createMenu({ screen: "title" });
  const G = IN.GEAR;
  assert.equal(m.gearHit(G.x, G.y), true);
  assert.equal(m.gearHit(10, 300), false);
  assert.equal(m.openSettings(), true);
  assert.equal(m.screen, "settings");
  assert.equal(m.toggle(), "title", "Esc / P goes back to the title");

  const p = IN.createMenu({ screen: "playing" });
  assert.equal(p.gearHit(G.x, G.y), false, "no gear while playing");
  assert.equal(p.openSettings(), false);
  p.toggle();
  assert.equal(p.gearHit(G.x, G.y), true);
  p.openSettings();
  assert.equal(p.toggle(), "pause");
});

test("settings screen: the top level has five rows and each section ends in Back", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings();
  assert.deepEqual(m.settingsRows().map((r) => r.label), ["Capsules", "Controls", "Sound", "Reset all", "Back"]);
  const T = IN.SETTINGS_TOP_LAYOUT;
  assert.ok(T.y + 5 * (T.h + T.gap) <= BB.H, "top rows fit");
  const L = IN.SETTINGS_LAYOUT;
  for (const [i, name] of [[0, "capsules"], [1, "controls"], [2, "sound"]]) {
    m.cursor = 0;
    assert.equal(m.activate(i), "section");
    assert.equal(m.section, name);
    const rows = m.settingsRows();
    assert.equal(rows[rows.length - 1].type, "back");
    assert.ok(L.y + rows.length * (L.h + L.gap) <= BB.H, name + " rows fit");
    assert.equal(m.activate(rows.length - 1), "back");
    assert.equal(m.section, null);
    assert.equal(m.cursor, i, "cursor on the section just left");
  }
});

test("settings screen: Esc or P leaves a section first, then Settings", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings();
  m.activate(2);
  assert.equal(m.toggle(), "settings");
  assert.equal(m.section, null);
  assert.equal(m.cursor, 2);
  assert.equal(m.toggle(), "title");
});

test("settings screen: Capsules is a read-only list, Controls and Sound hold their rows", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings();
  m.activate(0);
  const caps = m.settingsRows();
  assert.equal(caps.length, RW.RANKS.length + globalThis.BBSkills.FAMILIES.length + 1);
  assert.ok(caps.slice(0, -1).every((r) => r.type === "info"));
  assert.equal(m.activate(0), null, "no action");
  assert.equal(m.section, "capsules");
  m.toggle();
  m.activate(1);
  const rows = m.settingsRows();
  assert.deepEqual(rows.filter((r) => r.type === "key").map((r) => r.action), K.ACTIONS);
  assert.deepEqual(rows.filter((r) => r.type === "control").map((r) => r.label), ["D-pad"]);
  assert.ok(rows.some((r) => r.type === "padmap") && rows.some((r) => r.type === "reset"));
  assert.equal(rows.find((r) => r.action === "fire").value, "SPACE");
  m.toggle();
  m.activate(2);
  assert.deepEqual(m.settingsRows().map((r) => r.label), ["Music", "Sound FX", "Vibration", "Back"]);
});

test("settings screen: Reset all needs a second tap and keeps the high scores", () => {
  const store = memory();
  const m = IN.createMenu({ screen: "title", keys: K.createKeys(store), settings: K.createSettings(store), controls: K.createControls(store), pad: K.createPad(store) });
  let volumesReset = 0;
  m.onResetAll = () => { volumesReset++; };
  m.openSettings();
  m.keys.rebind("fire", "KeyF"); m.pad.rebind("fire", 8); m.settings.set("music", false); m.controls.set("dpad", true);
  const scores = JSON.stringify([{ score: 5, wave: 1 }]);
  store.setItem("bb.scores", scores);
  assert.equal(m.activate(3), "arm");
  assert.equal(m.settingsRows()[3].value, "Tap again to reset");
  m.move(-1);
  assert.equal(m.settingsRows()[3].value, "", "moving away cancels");
  m.activate(3);
  m.activate(0); m.toggle();
  assert.equal(m.settingsRows()[3].value, "", "another row cancels");
  assert.equal(m.keys.get("fire"), "KeyF");
  m.activate(3);
  assert.equal(m.activate(3), "resetall");
  assert.equal(m.keys.get("fire"), "Space");
  assert.equal(m.pad.get("fire"), 0);
  assert.equal(m.settings.get("music"), true);
  assert.equal(m.controls.get("dpad"), false);
  assert.equal(volumesReset, 1);
  assert.equal(store.data["bb.scores"], scores);
  m.activate(3);
  m.toggle();
  assert.equal(m.resetArmed, false, "leaving cancels");
});

test("settings screen: key capture rebinds the row, Esc cancels, arrows are refused", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings(); m.section = "controls";
  assert.equal(m.capture("KeyZ"), null, "nothing is waiting");
  const fireRow = m.settingsRows().findIndex((r) => r.action === "fire");
  assert.equal(m.activate(fireRow), "capture");
  assert.equal(m.capturing, "fire");
  assert.equal(m.settingsRows()[fireRow].value, "press a key");
  assert.equal(m.capture("ArrowUp"), "rejected");
  assert.equal(m.capturing, "fire", "still waiting");
  assert.equal(m.capture("KeyF"), "bound");
  assert.equal(m.capturing, null);
  assert.equal(m.keys.get("fire"), "KeyF");

  m.activate(fireRow);
  assert.equal(m.capture("Escape"), "cancel");
  assert.equal(m.keys.get("fire"), "KeyF", "cancel changes nothing");
  assert.equal(m.screen, "settings", "cancel stays on the screen");
});

test("settings screen: capture onto a used key swaps, and Reset keys restores", () => {
  const m = IN.createMenu({ screen: "pause" });
  m.openSettings(); m.section = "controls";
  const row = (a) => m.settingsRows().findIndex((r) => r.action === a);
  m.activate(row("left"));
  m.capture("KeyD");
  assert.equal(m.keys.get("left"), "KeyD");
  assert.equal(m.keys.get("right"), "KeyA");
  const reset = m.settingsRows().findIndex((r) => r.type === "reset");
  assert.equal(m.activate(reset), "reset");
  assert.deepEqual(m.keys.all(), K.DEFAULTS);
});

test("settings screen: the switches toggle and save, Back leaves", () => {
  const store = memory();
  const m = IN.createMenu({ screen: "title", keys: K.createKeys(store), settings: K.createSettings(store) });
  m.openSettings(); m.section = "sound";
  const rows = m.settingsRows();
  const music = rows.findIndex((r) => r.name === "music");
  assert.equal(m.activate(music), "switch");
  assert.equal(m.settingsRows()[music].value, "OFF");
  assert.equal(JSON.parse(store.data["bb.settings"]).music, false);
  assert.equal(m.activate(rows.length - 1), "back");
  assert.equal(m.section, null);
  assert.equal(m.activate(4), "back");
  assert.equal(m.screen, "title");
});

test("settings screen: arrows move the cursor and clicks find rows", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings();
  const n = m.settingsRows().length;
  m.move(-1);
  assert.equal(m.cursor, n - 1, "wraps");
  const T = IN.SETTINGS_TOP_LAYOUT, L = IN.SETTINGS_LAYOUT;
  assert.equal(m.itemAt(T.x + 10, T.y + 2 * (T.h + T.gap) + 5), 2);
  assert.equal(m.itemAt(5, 5), -1);
  m.activate(1);
  assert.equal(m.itemAt(L.x + 10, L.y + 2 * (L.h + L.gap) + 5), 2, "rows work inside a section too");
  m.toggle();
  m.move(-2); // from Controls (1) wraps to Back (4)
  assert.equal(m.activate(), "back", "cursor was on Back");
});

test("settings screen draws every row, the gear shows on title and pause, and nothing throws", () => {
  const g = BB.createGame();
  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  const m = IN.createMenu({ screen: "title" });
  r.draw({ game: g, menu: m, time: 0 });
  assert.ok(rec.log.some((c) => c.fn === "arc" && c.args[0] === IN.GEAR.x), "gear on the title");
  m.openSettings();
  const mark = rec.log.length;
  r.draw({ game: g, menu: m, time: 0 });
  const t = rec.log.slice(mark).filter((c) => c.fn === "fillText").map((c) => c.args[0]);
  for (const label of ["SETTINGS", "Capsules", "Controls", "Sound", "Reset all", "Back"]) {
    assert.ok(t.includes(label), label);
  }
  m.activate(1);
  const mark2 = rec.log.length;
  r.draw({ game: g, menu: m, time: 0 });
  const t2 = rec.log.slice(mark2).filter((c) => c.fn === "fillText").map((c) => c.args[0]);
  for (const label of ["SETTINGS › CONTROLS", "Move up", "Fire", "Special", "Pause", "Mute", "Reset keys", "Back"]) {
    assert.ok(t2.includes(label), label);
  }
  assert.ok(t2.includes("SPACE") && t2.includes("OFF")); // D-pad, off by default
  m.toggle(); m.activate(0);
  assert.doesNotThrow(() => r.draw({ game: g, menu: m, time: 0 }));
  m.toggle(); m.activate(2);
  assert.doesNotThrow(() => r.draw({ game: g, menu: m, time: 0 }));
  const p = IN.createMenu({ screen: "pause" });
  const before = rec.log.length;
  r.draw({ game: g, menu: p, time: 0 });
  assert.ok(rec.log.slice(before).some((c) => c.fn === "arc" && c.args[0] === IN.GEAR.x), "gear on pause");
});

test("how to play shows the current keys", () => {
  const keys = K.createKeys(null);
  const text = (rows) => rows.map((r) => r.text).join("\n");
  assert.match(text(RN.howToRows(keys)), /Fire: hold SPACE/);
  assert.match(text(RN.howToRows(keys)), /Special \(I\)/);
  assert.match(text(RN.howToRows(keys)), /Kaboom \(J\)/);
  assert.match(text(RN.howToRows(keys)), /Pause: P or Esc/);
  keys.rebind("fire", "KeyF"); keys.rebind("special", "KeyX");
  const after = text(RN.howToRows(keys));
  assert.match(after, /Fire: hold F /);
  assert.match(after, /Special \(X\)/);

  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  const menu = IN.createMenu({ screen: "howto", keys });
  r.draw({ game: BB.createGame(), menu, time: 0 });
  assert.ok(rec.log.some((c) => c.fn === "fillText" && /Special \(X\)/.test(c.args[0])));
});
