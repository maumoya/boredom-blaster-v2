import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/audio.js";
import "../src/assets.js";
import "../src/ui.js";
import "../src/worlds.js";
import "../src/render.js";

const BB = globalThis.BB, IN = globalThis.BBInput, RN = globalThis.BBRender, UI = globalThis.BBUI;

// Stub canvas: counts calls by name and records fill styles and composite operations.
// box: { width, height } makes getBoundingClientRect answer like a stretched phone canvas.
function stub(box) {
  const calls = {}, ops = new Set();
  const canvas = { width: 480, height: 640 };
  if (box) canvas.getBoundingClientRect = () => ({ left: 0, top: 0, ...box });
  const target = { canvas };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "createRadialGradient" || k === "createLinearGradient") {
        return () => { calls[k] = (calls[k] || 0) + 1; return { addColorStop(_, c) { if (c === "rgba(255,255,255,0.9)") calls.whiteGlow = (calls.whiteGlow || 0) + 1; } }; };
      }
      return () => { calls[k] = (calls[k] || 0) + 1; };
    },
    set(t, k, v) { if (k === "globalCompositeOperation") ops.add(v); if (k === "filter") calls.filter = (calls.filter || 0) + 1; t[k] = v; return true; },
  });
  return { ctx, calls, ops };
}

function setup(wave, box) {
  const g = BB.createGame({ rng: () => 0.5 });
  if (wave) g.wave = wave;
  g.drones = [];
  const E = BB.E();
  let x = 20;
  for (const sp of Object.keys(E.SPECIES)) { g.drones.push(E.createEnemy(g, sp, x, 80)); x += 50; }
  g.drones.forEach((d) => { d.entry = null; d.delay = 0; });
  g.bullets.push({ x: 200, y: 300, w: 4, h: 12 });
  g.enemyBullets.push({ x: 240, y: 200, w: 6, h: 10, vx: 0, vy: 100 });
  const s = stub(box), r = RN.createRenderer(s.ctx, null);
  return { g, r, ...s };
}
const view = (g, extra) => ({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: IN.createTouch(), time: 1, ...extra });

// ---- kept from Tasks 16 and 17 ----
test("ring buttons keep their sizes: FIRE 84 px across in the zone below, the rest no bigger than before", () => {
  const L = IN.layoutFor({ zone: "below", zoneH: 160 });
  assert.equal(L.buttons.fire.r * 2, 84);
  assert.equal(L.buttons.kaboom.r * 2, 60);
  assert.equal(L.buttons.special.r * 2, 68);
});

test("neon palette is unchanged", () => {
  assert.deepEqual(UI.NEON, {
    cyan: "#2ff3ff", magenta: "#ff3df0", yellow: "#fff23d", green: "#43ff8f", orange: "#ff9d2e",
    red: "#ff4468", violet: "#a066ff", white: "#f4f8ff", dim: "#8fa4d8", ink: "#050514",
  });
});

// ---- every screen and world draws ----
test("every world draws in play, with a ship, projectiles and a boss", () => {
  for (let w = 1; w <= 5; w++) {
    const { g, r } = setup((w - 1) * 100 + 1);
    r.update(0.016, g);
    assert.doesNotThrow(() => r.draw(view(g)), "world " + w);
  }
});

test("every screen draws on a stub canvas", () => {
  const { g, r } = setup(1);
  r.update(0.016, g);
  for (const screen of ["playing", "title", "pause", "howto", "scores", "settings", "initials", "results"]) {
    const menu = IN.createMenu({ screen });
    assert.doesNotThrow(() => r.draw({ ...view(g), menu, scores: [], results: { score: 1, wave: 1, stars: 1, goals: [] } }), screen);
  }
  g.status = "over";
  assert.doesNotThrow(() => r.draw(view(g)));
});

// ---- effects ----
test("projectiles, enemies and explosions use additive radial gradients and no blur", () => {
  const { g, r, calls, ops } = setup(1);
  r.update(0.016, g);
  g.drones = g.drones.slice(1);
  r.update(0.016, g);
  assert.ok(r.bloomCount() > 0, "explosion bloom");
  r.draw(view(g));
  assert.ok(ops.has("lighter"), "additive blending");
  assert.ok(calls.createRadialGradient > 20, "layered gradients");
  assert.equal(calls.filter, undefined);
});

test("hit flash: a damaged enemy gets a white overlay for 60 ms and throws sparks", () => {
  const { g, r, calls } = setup(1);
  const target = g.drones.find((d) => typeof d.hp === "number");
  r.update(0.016, g);
  const before = r.particles.length;
  target.hp -= 1;
  r.update(0.016, g);
  assert.ok(r.particles.length > before, "hit sparks");
  const w0 = calls.whiteGlow || 0;
  r.draw(view(g));
  const whiteHit = (calls.whiteGlow || 0) - w0;
  r.update(0.062, g); // just over 60 ms later the flash is gone
  const w1 = calls.whiteGlow || 0;
  r.draw(view(g));
  assert.ok(whiteHit > 0, "flash draws a white glow");
  assert.equal((calls.whiteGlow || 0) - w1, 0, "flash stops after 60 ms");
});

test("deaths leave larger debris and the particle cap of 400 holds", () => {
  const { r } = setup(1);
  r.explode(100, 100, true);
  assert.ok(r.particles.some((p) => p.debris && p.size >= 8), "debris chunks");
  for (let i = 0; i < 30; i++) r.explode(100 + i, 100, true);
  assert.ok(r.particles.length <= 400, "cap, got " + r.particles.length);
});

test("a frame over 20 ms steps the effects down; quick frames bring them back", () => {
  const { g, r } = setup(1);
  assert.equal(r.fullEffects(), true);
  r.update(0.021, g);
  assert.equal(r.fullEffects(), false);
  r.explode(50, 50, false);
  assert.ok(!r.particles.some((p) => p.debris), "no debris while stepped down");
  assert.equal(r.bloomCount(), 0);
  for (let i = 0; i < 120; i++) r.update(0.016, g);
  assert.equal(r.fullEffects(), true);
  assert.equal(setup(1).r.fullEffects(), true);
});

test("a frame of exactly 20 ms does not step down", () => {
  const { g, r } = setup(1);
  r.update(0.02, g);
  assert.equal(r.fullEffects(), true);
});

// ---- controls zone ----
test("the controls zone is painted edge to edge and holds the buttons and the bottom line", () => {
  for (const zoneH of [130, 190, 260]) {
    const { g, r, calls } = setup(1);
    const touch = IN.createTouch();
    touch.setLayout(IN.layoutFor({ zone: "below", zoneH }));
    r.draw({ ...view(g), touch });
    assert.ok(calls.createLinearGradient >= 1, "gradient fill for the zone " + zoneH);
    const L = IN.layoutFor({ zone: "below", zoneH });
    for (const b of Object.values(L.buttons)) assert.ok(b.y + b.r <= BB.H + zoneH - IN.STRIP_H, "buttons clear the bottom line");
  }
});

// ---- the empty strip on a stretched phone canvas (390x844 box -> 1038.8 logical units tall) ----
// A recording canvas: logs every clear / fill with its y-range and every gradient glow with its box.
function recorder(box) {
  const log = [], canvas = { width: 480, height: 640, getBoundingClientRect: () => ({ left: 0, top: 0, ...box }) };
  const state = { fillStyle: null };
  const ctx = new Proxy({ canvas }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "createRadialGradient") return (x, y, r0, x1, y1, r) => ({ radial: true, x: x1, y: y1, r, addColorStop() {} });
      if (k === "createLinearGradient") return () => ({ addColorStop() {} });
      if (k === "clearRect") return (x, y, w, h) => log.push({ kind: "clear", y0: y, y1: y + h });
      if (k === "fillRect") return (x, y, w, h) => log.push({ kind: "fill", y0: y, y1: y + h, glow: !!(state.fillStyle && state.fillStyle.radial) });
      return () => {};
    },
    set(t, k, v) { if (k === "fillStyle") state.fillStyle = v; t[k] = v; return true; },
  });
  return { ctx, log };
}

test("phone 390x844: every frame clears the full logical height first and no controls-zone glow stacks", () => {
  const box = { width: 390, height: 844 };
  const logical = (844 * 480) / 390;
  const g = BB.createGame({ rng: () => 0.5 });
  const { ctx, log } = recorder(box);
  const r = RN.createRenderer(ctx, null);
  const touch = IN.createTouch();
  touch.setLayout(IN.layoutFor({ zone: "below", zoneH: 190 }));
  for (let f = 0; f < 120; f++) {
    log.length = 0;
    r.update(0.016, g);
    r.draw({ ...view(g), touch, time: f / 60 });
    const first = log[0];
    assert.ok(first && first.y0 <= 0 && first.y1 >= 1038, "frame " + f + " first paint covers 0.." + logical);
    // a glow inside the zone must lie inside an area this frame already filled (a non-glow fill or clear before it)
    let covered = [];
    for (const e of log) {
      if (e.kind === "clear" || !e.glow) { covered.push([e.y0, e.y1]); continue; }
      if (e.y0 < BB.H) continue; // playfield glow
      assert.ok(covered.some(([a, b]) => a <= e.y0 && b >= e.y1), "frame " + f + " glow " + e.y0 + ".." + e.y1 + " outside a filled area");
    }
  }
});

test("phone 390x844: the strip under the bottom line gets the zone gradient, not a bare clear", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  const { ctx, log } = recorder({ width: 390, height: 844 });
  const r = RN.createRenderer(ctx, null);
  const touch = IN.createTouch();
  touch.setLayout(IN.layoutFor({ zone: "below", zoneH: 190 }));
  r.draw({ ...view(g), touch });
  assert.ok(log.some((e) => e.kind === "fill" && !e.glow && e.y0 <= BB.H && e.y1 >= 1038), "zone background reaches the bottom of the canvas");
});

// ---- bosses + explosions round ----
test("a beaten boss goes off in a chain of blasts with a flash; a world boss chains longer", () => {
  const { g, r } = setup(10);
  const boss = { x: 150, y: 60, w: 120, h: 90, hp: 40, maxHp: 40, boss: true, species: "drone" };
  g.drones.push(boss);
  r.update(0.016, g);
  g.drones = g.drones.filter((d) => d !== boss);
  r.update(0.016, g);
  assert.equal(r.chainCount(), 1, "chain started");
  assert.ok(r.bossFlash() > 0, "screen flash");
  for (let i = 0; i < 30; i++) r.update(0.05, g);
  assert.equal(r.chainCount(), 0, "chain finishes in about a second");
  assert.equal(r.bossFlash(), 0);
  assert.ok(r.particles.length <= 400);
  const world = { ...boss, worldBoss: true };
  g.drones.push(world); r.update(0.016, g);
  g.drones = []; r.update(0.016, g);
  let blasts = 0, last = r.particles.length;
  for (let i = 0; i < 20; i++) { r.update(0.05, g); if (r.particles.length > last) blasts++; last = r.particles.length; }
  assert.ok(blasts >= 8, "world boss chain keeps going");
});

test("explosions throw cooling fire and smoke; stepped down, no smoke", () => {
  const { r } = setup(1);
  r.explode(200, 200, true);
  assert.ok(r.particles.some((p) => p.fire), "fire");
  assert.ok(r.particles.some((p) => p.smoke), "smoke");
  const rr = setup(1).r;
  rr.update(0.05, BB.createGame());
  rr.update(0.05, BB.createGame()); // slow frames step the effects down
  rr.explode(200, 200, true);
  if (!rr.fullEffects()) assert.ok(!rr.particles.some((p) => p.smoke));
});

test("a boss under half life smokes; bosses draw an aura ring of arcs", () => {
  const { g, r, calls } = setup(10);
  const boss = { x: 150, y: 60, w: 120, h: 90, hp: 10, maxHp: 40, boss: true, species: "drone" };
  g.drones = [boss];
  for (let i = 0; i < 10; i++) r.update(0.05, g);
  assert.ok(r.particles.some((p) => p.smoke), "hurt boss smokes");
  const arcs = calls.arc || 0;
  r.draw(view(g));
  assert.ok((calls.arc || 0) - arcs >= 6, "aura arcs");
});

// ---- ship + weapons round ----
test("the ship leaves an engine trail, banks into turns and flashes at the nose when it fires", () => {
  const { g, r } = setup(1);
  g.bullets = [];
  for (let i = 0; i < 6; i++) { g.ship.x += 6; r.update(0.016, g); }
  assert.ok(r.shipFx().trail >= 5, "trail");
  assert.ok(r.shipFx().bank > 0.3, "banks right when moving right");
  for (let i = 0; i < 30; i++) r.update(0.016, g);
  assert.ok(Math.abs(r.shipFx().bank) < 0.05, "levels out when still");
  assert.ok(r.shipFx().trail <= 14);
  g.bullets.push({ x: 200, y: 500, w: 4, h: 12, dir: -1, vx: 0 });
  r.update(0.016, g);
  assert.ok(r.shipFx().muzzle > 0, "muzzle flash");
  g.bullets.push({ x: 200, y: 500, w: 20, h: 40, pierce: true });
  r.update(0.016, g);
  assert.ok(r.shipFx().special > 0, "special burst");
  r.update(0.016, g);
  const m = r.shipFx().muzzle;
  r.update(0.016, g);
  assert.ok(r.shipFx().muzzle < m, "an old bullet does not flash again");
});

test("reduced motion: the ship never banks", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  const r = RN.createRenderer(stub().ctx, null, { reducedMotion: true });
  for (let i = 0; i < 6; i++) { g.ship.x += 6; r.update(0.016, g); }
  assert.equal(r.shipFx().bank, 0);
});

test("bolts, the special shot and the laser all draw with additive glow", () => {
  const { g, r, calls, ops } = setup(1);
  g.bullets.push({ x: 100, y: 300, w: 4, h: 12, dir: -1, vx: 30, trail: true, tier: 6 }, { x: 150, y: 300, w: 20, h: 40, pierce: true });
  g.laserBeam = { cols: [200], reach: [50] };
  r.update(0.016, g);
  r.draw(view(g));
  assert.ok(ops.has("lighter"));
  assert.ok(calls.ellipse > 0, "special ring");
  assert.ok(calls.fillRect > 10);
  assert.equal(calls.filter, undefined);
});
