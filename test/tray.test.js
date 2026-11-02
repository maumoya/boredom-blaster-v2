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

const BB = globalThis.BB, IN = globalThis.BBInput, UI = globalThis.BBUI, RN = globalThis.BBRender;
const TRAY_Y = 640 - 120;
const TOP_BAR = 60; // the floating two-row top panel (BB.HUD_H is the game's ship limit)

// Stub canvas that records every call with its arguments; gradients come back empty (like the old stub).
function recorder() {
  const log = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { log.push({ fn: k, args, font: t.font }); return undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log, mark: () => log.length };
}

test("style kit: panel, button (idle, hot, pressed, disabled), title, stars and every icon draw without errors", () => {
  const { ctx, log } = recorder();
  const ui = UI.createUI(ctx);
  ui.panel(10, 10, 200, 100);
  for (const state of ["idle", "hot", "pressed", "disabled"]) ui.button(10, 10, 120, 38, "Resume", state);
  ui.title("PAUSED", 240, 200, 36);
  ui.stars(240, 300, 2, 3, 9);
  for (const name of UI.ICONS) {
    ui.icon(name, 50, 50, 20, "#fff");
    ui.iconButton(50, 50, 30, name, { state: "pressed", label: "X" });
  }
  assert.ok(log.length > 100);
  assert.ok(UI.ICONS.length >= 8);
});

test("style kit: works when the canvas returns real gradients", () => {
  const stops = [];
  const grad = { addColorStop: (...a) => stops.push(a) };
  const { ctx } = recorder();
  const withGrad = new Proxy(ctx, {
    get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient" ? () => grad : t[k]),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  UI.createUI(withGrad).button(0, 0, 100, 40, "A", "idle");
  assert.ok(stops.length >= 2);
});

test("style kit: a pressed button sits lower than an idle one", () => {
  const rect = (state) => {
    const { ctx, log } = recorder();
    UI.createUI(ctx).iconButton(100, 100, 30, "fire", { state });
    return log.filter((c) => c.fn === "arc")[1].args[1];
  };
  assert.ok(rect("pressed") > rect("idle"));
});

test("buttons layout: FIRE, SPEC and BOOM sit in the bottom 120 px of the screen, for both hands", () => {
  const touch = IN.createTouch(false);
  for (const B of [IN.BUTTONS, IN.mirrorButtons()]) {
    for (const name of ["fire", "special", "kaboom"]) {
      const b = B[name];
      assert.ok(b.y - b.r >= TRAY_Y, name + " top");
      assert.ok(b.y + b.r <= 640, name + " bottom");
      assert.ok(b.x - b.r >= 0 && b.x + b.r <= 480, name + " sides");
    }
  }
  assert.equal(IN.TRAY_H, 0, "no tray");
  assert.equal(IN.PLAY_H, 640, "the playfield reaches the bottom edge");
  touch.setLeftHanded(true);
  assert.equal(touch.buttons().fire.x, 480 - IN.BUTTONS.fire.x);
  assert.equal(touch.buttons().fire.y, IN.BUTTONS.fire.y);
});

test("tray: the buttons sit on the thumb side and do not overlap each other", () => {
  const B = IN.BUTTONS, names = Object.keys(B);
  for (const n of names) assert.ok(B[n].x - B[n].r - 10 >= 240, n + " stays out of the stick half");
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = B[names[i]], b = B[names[j]];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r, names[i] + "/" + names[j]);
    }
  }
});

test("playfield: ship, formation and enemy bullets run down to the bottom edge", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  g.drones = [{ x: 0, y: 40, w: BB.DRONE.w, h: BB.DRONE.h }];
  BB.update(g, 100, { down: true });
  assert.equal(g.ship.y + g.ship.h, BB.PLAY_H);

  g.enemyBullets = [{ x: 300, y: BB.PLAY_H - 12, w: 6, h: 10, vx: 0, vy: 200 }];
  BB.update(g, 0.1, {});
  assert.equal(g.enemyBullets.length, 0, "the shot is gone at the bottom edge");

  const h = BB.createGame({ rng: () => 0.5 });
  h.drones = [{ x: 0, y: BB.PLAY_H - BB.DRONE.h, w: BB.DRONE.w, h: BB.DRONE.h }, { x: 100, y: 40, w: BB.DRONE.w, h: BB.DRONE.h }];
  BB.update(h, 0.016, {});
  assert.equal(h.lives, BB.START_LIVES - 1, "a formation drone reaching the bottom edge costs a life");
});

test("playfield: a new wave starts below the top bar", () => {
  const g = BB.createGame();
  for (const d of g.drones.filter((e) => !e.pattern || e.pattern === "formation")) assert.ok(d.y >= BB.HUD_H);
});

test("pause icon: hit box is in the top bar, nowhere near the playfield or tray", () => {
  const P = IN.PAUSE_BUTTON;
  assert.ok(P.y + P.h <= BB.HUD_H);
  assert.ok(IN.pauseHit(P.x + P.w / 2, P.y + P.h / 2));
  assert.equal(IN.pauseHit(240, 300), false);
  assert.equal(IN.pauseHit(P.x + P.w / 2, TRAY_Y + 20), false);
  assert.equal(IN.pauseHit(20, 20), false);
});

function view(game, extra) {
  const touch = IN.createTouch();
  const menu = IN.createMenu({ screen: "playing" });
  return { game, menu, best: 99, touch, touchSeen: true, time: 1, ...extra };
}

function drawWith(game, extra) {
  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  r.update(0.016, game);
  const v = view(game, extra);
  const start = rec.mark();
  r.draw(v);
  return { ...rec, start, r, v };
}

const texts = (log) => log.filter((c) => c.fn === "fillText").map((c) => String(c.args[0]));

test("HUD: shows ×0 lives, never blank", () => {
  const g = BB.createGame();
  g.lives = 0;
  assert.ok(texts(drawWith(g).log).includes("×0"));
  g.lives = 3;
  assert.ok(texts(drawWith(g).log).includes("×3"));
});

test("HUD: shows wave, best and the score counter", () => {
  const g = BB.createGame();
  g.score = 1234; g.wave = 4;
  const t = texts(drawWith(g).log);
  assert.ok(t.includes("WAVE 4"));
  assert.ok(!t.some((x) => x.startsWith("BEST"))); // best is no longer on the HUD
  assert.ok(t.some((s) => s.endsWith("1234")));
});

test("HUD: shield pips (and the super timer) are drawn only inside the floating top panel", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  g.weaponLevel = 5; g.shield = 3; g.superStar = 4;
  BB.R().addEscort(g); BB.R().addEscort(g);
  g.drones = []; // nothing else in the playfield, so every call below the bar would be a HUD leak
  g.capsules = []; g.bullets = []; g.enemyBullets = []; g.escorts = [];
  BB.R().addEscort(g);
  // draw with the ship hidden so only background, HUD and tray remain
  g.status = "over";
  const { log } = drawWith(g, { touch: null });
  const pips = log.filter((c) => c.fn === "arc" && c.args[2] === 2.6);
  assert.ok(pips.length >= 5, "shield pips drawn");
  for (const c of pips) assert.ok(c.args[1] <= TOP_BAR, "pip in the top panel, y=" + c.args[1]);
});

test("HUD: with no boss, no HUD text or rect sits between the top bar and the tray", () => {
  const g = BB.createGame();
  g.drones = []; g.status = "playing";
  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  r.draw(view(g));
  const mid = rec.log.filter((c) => c.fn === "fillText" && c.args[2] > BB.HUD_H && c.args[2] < TRAY_Y);
  assert.deepEqual(mid.map((c) => c.args[0]), []);
});

test("HUD: in a boss fight only the paired bars sit below the top panel: YOU on the left, BOSS on the right", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  const boss = BB.E().createEnemy(g, Object.keys(BB.E().BOSSES)[0] || "drone", 200, 100);
  boss.boss = true; boss.entry = null; boss.delay = 0; boss.hp = boss.maxHp = boss.maxHp || 10;
  g.drones = [boss];
  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  r.draw(view(g));
  const labels = rec.log.filter((c) => c.fn === "fillText" && c.args[2] > TOP_BAR && c.args[2] < TRAY_Y).map((c) => c.args[0]);
  assert.deepEqual(labels.sort(), ["BOSS", "YOU"]);
  const boss_ = rec.log.find((c) => c.fn === "fillText" && c.args[0] === "BOSS"), you = rec.log.find((c) => c.fn === "fillText" && c.args[0] === "YOU");
  assert.ok(boss_.args[1] > 240 && you.args[1] < 240, "boss right, player left");
});

test("tray: SPEC cooldown ring runs by the cooldown and BOOM greys out when empty", () => {
  const g = BB.createGame();
  g.specialCooldown = BB.SPECIAL.cooldown / 2;
  g.kaboomCharges = 0;
  const { log } = drawWith(g);
  const ring = log.filter((c) => c.fn === "arc" && Math.abs(c.args[4] - -Math.PI / 2 - Math.PI) < 1e-9);
  assert.equal(ring.length, 1, "half-way ring");
  assert.equal(ring[0].args[2], IN.BUTTONS.special.r + 8);
  g.kaboomCharges = 2;
  const segs = drawWith(g).log.filter((c) => c.fn === "arc" && c.args[2] === IN.BUTTONS.kaboom.r + 8 && c.args[4] - c.args[3] < Math.PI * 2 - 1e-9);
  assert.equal(segs.length, BB.KABOOM.maxCharges, "one arc segment per charge slot");
});

test("tray: draws mirrored for the left-hand swap and without a touch object", () => {
  const g = BB.createGame();
  const { log } = drawWith(g, { touch: null, menu: IN.createMenu({ screen: "playing", leftHanded: true }) });
  const mirrored = IN.mirrorButtons().fire;
  assert.ok(log.some((c) => c.fn === "arc" && c.args[0] === mirrored.x && c.args[2] === mirrored.r));
});

test("effects: explosions add a shockwave and more particles; every screen still draws", () => {
  const g = BB.createGame();
  const rec = recorder();
  const r = RN.createRenderer(rec.ctx, null);
  r.explode(200, 200, false);
  const small = r.particles.length;
  r.explode(200, 200, true);
  assert.ok(r.particles.length - small > small, "big blast is bigger");
  r.update(0.1, g);
  r.draw(view(g));
  for (let i = 0; i < 20; i++) r.update(0.05, g);
  assert.equal(r.particles.length, 0);
  for (const screen of ["pause", "howto", "playing"]) r.draw(view(g, { menu: IN.createMenu({ screen }) }));
  g.status = "over";
  r.draw(view(g));
});

test("shield: a soaked hit lights the silver shield for half a second", () => {
  const g = BB.createGame();
  g.shield = 2;
  assert.equal(BB.R().absorbHit(g), true);
  assert.equal(g.shieldFlash, 0.5);
  BB.R().updateTimers(g, 0.3);
  assert.ok(Math.abs(g.shieldFlash - 0.2) < 1e-9);
  BB.R().updateTimers(g, 0.3);
  assert.equal(g.shieldFlash, 0);
});
