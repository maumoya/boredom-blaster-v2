import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/assets.js";
import "../src/ui.js";
import "../src/render.js";

const BB = globalThis.BB, IN = globalThis.BBInput, AS = globalThis.BBAssets, RN = globalThis.BBRender;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- assets ----
test("asset manifest: every sprite name maps to a file under assets/ that exists", () => {
  const names = Object.keys(AS.MANIFEST);
  assert.ok(names.length > 20);
  for (const name of names) {
    assert.ok(AS.MANIFEST[name].startsWith("kenney/"), name);
    assert.ok(existsSync(join(root, AS.urlOf(name))), `${name} -> ${AS.urlOf(name)}`);
  }
});

test("asset manifest: has a sprite for every species, capsule rank and the effects", () => {
  for (const s of Object.keys(BB.E().SPECIES)) assert.ok(AS.MANIFEST[s], s);
  for (const r of ["Bronze", "Silver", "Gold", "Rainbow"]) assert.ok(AS.MANIFEST["capsule" + r], r);
  for (const n of ["ship", "bullet", "enemyBullet", "shield", "spark", "star1", "meteorBig1"]) assert.ok(AS.MANIFEST[n], n);
});

const fakeImage = (outcome) => () => {
  const img = { width: 10, height: 10 };
  Object.defineProperty(img, "src", {
    set(v) { img.url = v; setImmediate(() => (outcome(v) ? img.onload() : img.onerror())); },
  });
  return img;
};
const tick = () => new Promise((r) => setImmediate(r));

test("assets: images that load are returned, failed ones give null", async () => {
  const assets = AS.createAssets(fakeImage((url) => !url.includes("playerShip1_blue")));
  await tick(); await tick();
  assert.equal(assets.get("ship"), null);
  assert.deepEqual(assets.failed(), ["ship"]);
  assert.ok(assets.get("drone"));
});

// ---- render smoke ----
function stubCtx() {
  const calls = { drawImage: 0, fillRect: 0, total: 0 };
  const target = { canvas: { width: 480, height: 640 } };
  return {
    calls,
    ctx: new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k];
        return (...args) => { calls.total++; if (k in calls) calls[k]++; return undefined; };
      },
      set(t, k, v) { t[k] = v; return true; },
    }),
  };
}

function busyGame() {
  const g = BB.createGame({ rng: () => 0.5 });
  const E = BB.E();
  g.drones = [];
  let x = 20;
  for (const sp of Object.keys(E.SPECIES)) {
    g.drones.push(E.createEnemy(g, sp, x, 80));
    x += 55;
  }
  for (const rank of BB.R().RANKS) BB.R().spawnCapsule(g, 100, 200, rank);
  g.bullets.push({ x: 200, y: 300, w: 4, h: 12 }, { x: 220, y: 300, w: 40, h: 16, pierce: true });
  g.enemyBullets.push({ x: 240, y: 200, w: 6, h: 10, vx: 0, vy: 100 });
  g.shield = 2; g.superStar = 3; g.weaponLevel = 3; g.invuln = 0;
  BB.R().addEscort(g); BB.R().addEscort(g);
  g.drones.find((d) => d.boss).hp = 7;
  g.drones.forEach((d) => { d.entry = null; d.delay = 0; });
  return g;
}

function drawAll(assets) {
  const { ctx, calls } = stubCtx();
  const r = RN.createRenderer(ctx, assets);
  const touch = IN.createTouch();
  touch.start(1, 100, 400);
  const menu = IN.createMenu({ screen: "playing" });
  const g = busyGame();
  const view = (extra) => ({ game: g, menu, best: 1234, touch, touchSeen: true, time: 1.5, ...extra });
  r.update(0.016, g);
  g.drones = g.drones.slice(2); // two vanish: explosions
  g.lives = 2;
  r.update(0.016, g);
  assert.ok(r.particles.length > 0, "explosion particles");
  r.draw(view());
  menu.screen = "pause"; r.draw(view());
  menu.screen = "howto"; r.draw(view());
  menu.screen = "playing"; g.status = "over"; r.draw(view());
  g.status = "playing"; g.lives = 1; g.superStar = 0; g.shield = 0; r.draw(view());
  return calls;
}

test("render smoke: draws every species, boss, capsule, effect and HUD state with sprites", () => {
  const assets = AS.createAssets(fakeImage(() => true));
  return tick().then(() => {
    const calls = drawAll(assets);
    assert.ok(calls.drawImage > 20, "sprites drawn");
  });
});

test("render smoke: falls back to plain shapes when every image failed", async () => {
  const assets = AS.createAssets(fakeImage(() => false));
  await tick(); await tick();
  const calls = drawAll(assets);
  assert.equal(calls.drawImage, 0);
  assert.ok(calls.total > 100);
});

test("render smoke: works before any image has loaded", () => {
  drawAll(AS.createAssets(() => ({ set src(v) {} })));
});

// ---- store ----
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test("best score: saves, loads and only goes up", () => {
  const s = memoryStorage();
  const store = IN.createStore(s);
  assert.equal(store.loadBest(), 0);
  assert.equal(store.saveBest(500), 500);
  assert.equal(store.saveBest(200), 500);
  assert.equal(IN.createStore(s).loadBest(), 500);
});

test("best score: garbage or a broken storage never throws", () => {
  const s = memoryStorage();
  s.setItem("bb.best", "abc");
  assert.equal(IN.createStore(s).loadBest(), 0);
  const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  const store = IN.createStore(broken);
  assert.equal(store.loadBest(), 0);
  store.saveBest(10);
  store.saveLeftHanded(true);
  assert.equal(IN.createStore(null).loadBest(), 0);
});

test("left-hand setting saves and loads", () => {
  const s = memoryStorage();
  assert.equal(IN.createStore(s).loadLeftHanded(), false);
  IN.createStore(s).saveLeftHanded(true);
  assert.equal(IN.createStore(s).loadLeftHanded(), true);
  IN.createStore(s).saveLeftHanded(false);
  assert.equal(IN.createStore(s).loadLeftHanded(), false);
});

// ---- menus ----
test("pause menu: toggle, move, activate", () => {
  const m = IN.createMenu({ screen: "playing" });
  assert.equal(m.toggle(), "pause");
  m.move(1);
  assert.equal(m.cursor, 1);
  m.move(-2);
  assert.equal(m.cursor, 4, "wraps");
  m.cursor = 0;
  assert.equal(m.activate(), "resume");
  assert.equal(m.screen, "playing");
  m.toggle();
  assert.equal(m.toggle(), "playing");
});

test("pause menu: swap toggles the label, restart and click picking work", () => {
  const m = IN.createMenu({ screen: "pause" });
  assert.equal(m.items()[2], "Left-hand: OFF");
  const L = IN.MENU_LAYOUT;
  const i = m.itemAt(L.x + 5, L.y + 2 * (L.h + L.gap) + 5);
  assert.equal(i, 2);
  assert.equal(m.activate(i), "swap");
  assert.equal(m.leftHanded, true);
  assert.equal(m.items()[2], "Left-hand: ON");
  assert.equal(m.screen, "pause");
  assert.equal(m.itemAt(0, 0), -1);
  assert.equal(m.activate(3), "restart");
  assert.equal(m.screen, "playing");
});

test("how-to-play: shown at start, dismissed by toggle or activate, reachable from pause", () => {
  const m = IN.createMenu();
  assert.equal(m.screen, "howto");
  assert.equal(m.toggle(), "playing");
  m.toggle(); // pause
  assert.equal(m.activate(1), "howto");
  assert.equal(m.screen, "howto");
  assert.equal(m.activate(), "resume");
  assert.equal(m.screen, "pause", "returns to the pause menu");
  m.toggle();
  assert.equal(m.screen, "playing");
  assert.ok(RN.HOW_TO.length >= 5);
});

// ---- mouse and left-hand steering ----
test("mouse drag on the left half drives the joystick", () => {
  const touch = IN.createTouch();
  const mouse = IN.createMouse(touch);
  assert.ok(mouse.down(100, 400, 0));
  mouse.move(150, 400);
  assert.ok(touch.axes().x > 0);
  mouse.move(100, 340);
  assert.ok(touch.axes().y < 0);
  mouse.up();
  assert.deepEqual(touch.axes(), { x: 0, y: 0 });
  assert.equal(mouse.isDown(), false);
});

test("mouse: right button is ignored, moves without a press do nothing, right half cannot steer", () => {
  const touch = IN.createTouch();
  const mouse = IN.createMouse(touch);
  assert.equal(mouse.down(100, 400, 2), false);
  mouse.move(200, 400);
  assert.deepEqual(touch.axes(), { x: 0, y: 0 });
  mouse.down(300, 300, 0);
  mouse.move(400, 300);
  assert.deepEqual(touch.axes(), { x: 0, y: 0 });
});

test("mouse click on the FIRE button holds fire until release", () => {
  const touch = IN.createTouch();
  const mouse = IN.createMouse(touch);
  mouse.down(IN.BUTTONS.fire.x, IN.BUTTONS.fire.y, 0);
  assert.equal(touch.fire(), true);
  mouse.up();
  assert.equal(touch.fire(), false);
});

test("left-hand swap: stick on the right half, buttons mirrored to the left", () => {
  const touch = IN.createTouch(true);
  touch.start(1, 100, 400); // left half is now the button side, no button here
  touch.move(1, 160, 400);
  assert.deepEqual(touch.axes(), { x: 0, y: 0 });
  touch.start(2, 380, 400);
  touch.move(2, 430, 400);
  assert.ok(touch.axes().x > 0);
  const fire = touch.buttons().fire;
  assert.equal(fire.x, 480 - IN.BUTTONS.fire.x);
  touch.start(3, fire.x, fire.y);
  assert.equal(touch.fire(), true);
});

test("left-hand swap: switching live releases held input and flips sides", () => {
  const touch = IN.createTouch();
  touch.start(1, 100, 400);
  touch.start(2, IN.BUTTONS.fire.x, IN.BUTTONS.fire.y);
  touch.setLeftHanded(true);
  assert.equal(touch.fire(), false);
  assert.equal(touch.stick.state.active, false);
  assert.equal(touch.buttons().fire.x, 480 - IN.BUTTONS.fire.x);
  touch.setLeftHanded(false);
  assert.equal(touch.buttons().fire.x, IN.BUTTONS.fire.x);
});

test("keyboard: Escape also pauses", () => {
  const k = IN.createKeyboard();
  assert.equal(k.keydown("Escape"), true);
  assert.equal(k.takePressed().pause, true);
});
