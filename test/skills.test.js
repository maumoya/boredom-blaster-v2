import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/ui.js";
import "../src/render.js";

const BB = globalThis.BB, S = globalThis.BBSkills, RW = globalThis.BBRewards, IN = globalThis.BBInput, RN = globalThis.BBRender;
const drone = (x, y) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h });
const quietGame = () => { const g = BB.createGame({ rng: () => 0.5 }); g.drones = [drone(0, 60)]; return g; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " vs " + b);

test("seven families; all start at 0 except More shots at 1", () => {
  assert.deepEqual(S.FAMILIES.map((f) => f.name),
    ["More shots", "Faster shots", "Larger shots", "Laser", "Moons", "Magneto", "Score per hit"]);
  const g = quietGame();
  for (const f of S.FAMILIES) assert.equal(S.tier(g, f.id), f.id === "more" ? 1 : 0);
});

test("More shots: 1-5 streams, MASTERED 7 in a fan, ULTRA-MAD 9 plus 2 rear shots", () => {
  for (let t = 1; t <= 5; t++) { assert.equal(S.moreCount(t), t); assert.equal(S.volley(t).length, t); }
  assert.equal(S.moreCount(6), 7);
  assert.equal(S.moreCount(7), 9);
  assert.equal(S.rearShots(6), 0);
  assert.equal(S.rearShots(7), 2);
  assert.ok(S.volley(6).some((v) => v.angle !== 0), "a fan");
  assert.equal(S.volley(7).filter((v) => v.dir > 0).length, 2);
  for (const [t, n] of [[5, 5], [6, 7], [7, 11]]) {
    const g = quietGame();
    g.skills.more = t;
    BB.shoot(g);
    assert.equal(g.bullets.length, n, "tier " + t);
  }
});

test("Faster shots: +15% fire rate and +8% bullet speed per level, x2 and x2.5 at the top", () => {
  for (let t = 1; t <= 5; t++) { near(S.fireRate(t), 1 + 0.15 * t); near(S.bulletSpeed(t), 1 + 0.08 * t); }
  assert.equal(S.fireRate(0), 1);
  assert.equal(S.fireRate(6), 2);
  assert.equal(S.fireRate(7), 2.5);
  assert.equal(S.hasTrails(6), false);
  assert.equal(S.hasTrails(7), true);
  const g = quietGame();
  g.skills.faster = 7;
  BB.shoot(g);
  near(g.cooldown, BB.BULLET.cooldown / 2.5);
  assert.equal(g.bullets[0].trail, true);
});

test("Larger shots: hit box +15% per level, pierce 1 from level 3, 2 MASTERED, 3 ULTRA-MAD and twice as wide", () => {
  for (let t = 1; t <= 5; t++) near(S.sizeMult(t), 1 + 0.15 * t);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(S.pierce), [0, 0, 0, 1, 1, 1, 2, 3]);
  near(S.widthMult(7), S.sizeMult(7) * 2);
  near(S.widthMult(6), S.sizeMult(6));
  const g = quietGame();
  g.skills.larger = 3;
  BB.shoot(g);
  near(g.bullets[0].w, BB.BULLET.w * 1.45);
  assert.equal(g.bullets[0].pierces, 1);
});

test("a pierce-1 bullet kills two enemies in a row, a plain one only the first", () => {
  for (const [tier, left] of [[3, 1], [0, 2]]) { // the far-away spare drone always stays
    const g = quietGame();
    g.drones = [drone(0, 60), drone(200, 300), drone(200, 306)];
    g.bullets = [{ x: 205, y: 310, w: 4, h: 12, pierces: S.pierce(tier), speed: 0.001 }];
    for (let i = 0; i < 3; i++) BB.update(g, 0.001, {});
    assert.equal(g.drones.length, left, "tier " + tier);
  }
});

test("Laser, Moons and Magneto numbers", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(S.laserCrosses), [1, 2, 3, 4, 5]);
  assert.deepEqual([6, 7].map(S.laserBeams), [2, 3]);
  assert.equal(S.laserCrosses(6), Infinity);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(S.moonCount), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([1, 5, 6, 7].map(S.moonHits), [3, 3, 5, 7]);
  assert.deepEqual([1, 2, 3, 4, 5].map(S.magnetoRange), [48, 96, 144, 192, 240]);
  assert.equal(S.magnetoRange(6), Infinity);
  assert.equal(S.magnetoRange(7), Infinity);
  assert.equal(S.magnetoSpeed(6), 1);
  assert.equal(S.magnetoSpeed(7), 2);
});

test("Score per hit: +10% per level, x2 MASTERED, x3 ULTRA-MAD with red floating points", () => {
  for (let t = 1; t <= 5; t++) near(S.scoreMult(t), 1 + 0.1 * t);
  assert.equal(S.scoreMult(6), 2);
  assert.equal(S.scoreMult(7), 3);
  const kill = (tier) => {
    const g = quietGame();
    g.skills.score = tier;
    g.drones = [drone(100, 100)];
    g.bullets = [{ x: 110, y: 100, w: 4, h: 12 }];
    BB.update(g, 0.001, {});
    return g;
  };
  assert.equal(kill(0).score, 10);
  assert.equal(kill(5).score, 15);
  assert.equal(kill(6).score, 20);
  const top = kill(7);
  assert.equal(top.score, 30);
  assert.equal(top.pops.length, 1);
  assert.equal(top.pops[0].text, "+30");
});

test("every tier 0 to 7 of every family is defined and the picker text says what is next", () => {
  for (const f of S.FAMILIES) for (let t = 0; t <= 7; t++) assert.ok(S.nextText(f.id, t), f.id + t);
  assert.equal(S.tierName(6), "MASTERED");
  assert.equal(S.tierName(7), "ULTRA-MAD");
  assert.equal(S.tierName(5), "");
});

test("capsules: bronze 1 pick, silver 1 pick + 3 shield, gold 2 picks", () => {
  let g = quietGame();
  RW.applyCapsule(g, "bronze");
  assert.ok(g.picker); assert.equal(g.picks, 1);
  g = quietGame();
  RW.applyCapsule(g, "silver");
  assert.equal(g.shield, 3); assert.equal(g.picks, 1);
  g = quietGame();
  RW.applyCapsule(g, "gold");
  assert.equal(g.picks, 2);
  S.choose(g, "laser");
  assert.ok(g.picker, "the picker reopens for the second pick");
  S.choose(g, "laser");
  assert.equal(g.picker, null);
  assert.equal(S.tier(g, "laser"), 2);
});

test("a capsule is worth 2,000 points when everything is ULTRA-MAD, and the escort capsule is gone", () => {
  const g = quietGame();
  for (const f of S.FAMILIES) g.skills[f.id] = 7;
  RW.applyCapsule(g, "gold");
  assert.equal(g.score, 2000);
  assert.equal(g.picker, null);
  assert.equal(RW.REWARD.gold, "skill");
  assert.equal(Object.values(RW.REWARD).includes("escort"), false);
  RW.applyCapsule(g, "bronze");
  assert.equal(g.score, 4000);
});

test("the picker: keys 1 to 7, arrows plus Enter, through the real keyboard; skips ULTRA-MAD cards", () => {
  const g = quietGame();
  const kb = IN.createKeyboard();
  RW.applyCapsule(g, "bronze");
  assert.equal(S.picker, g.picker);
  assert.equal(kb.keydown("Digit4"), true);
  assert.equal(S.tier(g, "laser"), 1);
  assert.equal(g.picker, null);
  assert.equal(S.picker, null);
  g.skills.faster = 7;
  RW.applyCapsule(g, "bronze");
  g.picker.cursor = 0;
  kb.keydown("ArrowRight"); // Faster shots is ULTRA-MAD: skipped
  assert.equal(g.picker.cursor, 2);
  kb.keydown("ArrowLeft");
  assert.equal(g.picker.cursor, 0);
  kb.keydown("ArrowRight"); kb.keydown("Enter");
  assert.equal(S.tier(g, "larger"), 1);
  RW.applyCapsule(g, "bronze");
  kb.keydown("Digit2"); // greyed out: nothing happens
  assert.ok(g.picker);
  assert.equal(S.tier(g, "faster"), 7);
});

test("the picker by touch: tapping a card picks it, other taps do not steer or fire", () => {
  const g = quietGame();
  const touch = IN.createTouch();
  RW.applyCapsule(g, "bronze");
  const r = S.cardRect(6);
  touch.start(1, r.x + 10, r.y + 10);
  assert.equal(S.tier(g, "score"), 1);
  assert.equal(g.picker, null);
  RW.applyCapsule(g, "bronze");
  touch.start(2, 10, 630);
  assert.ok(g.picker, "a tap outside the cards leaves it open");
  assert.equal(touch.axes().x, 0);
});

test("the game runs at 15% speed while the picker is open", () => {
  const g = quietGame();
  g.drones = [drone(0, 60), drone(300, 60)];
  RW.applyCapsule(g, "bronze");
  RW.spawnCapsule(g, 240, 100, "bronze");
  const y0 = g.capsules[0].y;
  BB.update(g, 0.1, {});
  near(g.capsules[0].y - y0, RW.CAPSULE.speed * 0.1 * S.SLOW);
  S.choose(g, "more");
  const y1 = g.capsules[0].y;
  BB.update(g, 0.1, {});
  near(g.capsules[0].y - y1, RW.CAPSULE.speed * 0.1);
});

test("the picker offers a step to MASTERED only below a 0.5 roll and to ULTRA-MAD only below 0.25", () => {
  const offered = (tierNow, roll) => {
    const g = quietGame();
    for (const f of S.FAMILIES) g.skills[f.id] = 1;
    g.skills.laser = tierNow;
    g.rng = () => roll;
    RW.applyCapsule(g, "bronze");
    return g.picker ? g.picker.offered.includes("laser") : null;
  };
  assert.equal(offered(5, 0.49), true);
  assert.equal(offered(5, 0.5), false);
  assert.equal(offered(6, 0.24), true);
  assert.equal(offered(6, 0.25), false);
  assert.equal(offered(4, 0.99), true, "ordinary tiers are always offered");
  const g = quietGame();
  for (const f of S.FAMILIES) g.skills[f.id] = 5;
  g.rng = () => 0.5;
  RW.applyCapsule(g, "bronze");
  assert.equal(g.score, S.ULTRA_BONUS_POINTS, "no choice left: the capsule gives points");
  assert.equal(g.picker, null);
});

test("every unabsorbed hit drops the last upgraded family, MASTERED and ULTRA-MAD included; the shield drops nothing", () => {
  const lose = (g) => { g.invuln = 0; g.drones = [drone(g.ship.x, g.ship.y)]; BB.update(g, 0.001, {}); };
  const g = quietGame();
  S.upgrade(g, "laser"); S.upgrade(g, "laser"); S.upgrade(g, "more");
  lose(g);
  assert.equal(S.tier(g, "more"), 1);
  assert.equal(S.tier(g, "laser"), 2, "only the latest family drops");
  const h = quietGame();
  h.skills.score = 5; S.upgrade(h, "score"); // now MASTERED, most recent
  lose(h);
  assert.equal(S.tier(h, "score"), 5, "MASTERED 6 -> 5");
  S.upgrade(h, "score"); S.upgrade(h, "score"); // ULTRA-MAD, most recent
  lose(h);
  assert.equal(S.tier(h, "score"), 6, "ULTRA-MAD 7 -> 6");
  assert.equal(h.lives, BB.START_LIVES - 2);
  const s = quietGame();
  S.upgrade(s, "laser"); s.shield = 1;
  lose(s);
  assert.equal(S.tier(s, "laser"), 1, "a shield-absorbed hit costs nothing");
  assert.equal(s.shield, 0);
  lose(s);
  assert.equal(S.tier(s, "laser"), 0);
});

test("rainbow: Super Star, or a TWIN charge when Super Star is already on", () => {
  const g = quietGame();
  RW.applyCapsule(g, "rainbow");
  assert.equal(g.superStar, 8);
  RW.applyCapsule(g, "rainbow");
  assert.equal(g.twinCharges, 1);
  RW.applyCapsule(g, "rainbow"); RW.applyCapsule(g, "rainbow");
  assert.equal(g.twinCharges, RW.TWIN.maxCharges);
});

// ---- drawing: a stub canvas that honours save()/restore() for globalCompositeOperation ----
function stubCanvas() {
  const stack = [], log = { additiveArcs: 0, fills: [], texts: [], embers: [] };
  const state = {
    globalCompositeOperation: "source-over", fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1,
    canvas: { width: 480, height: 640 },
  };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "save") return () => { stack.push({ ...t }); };
      if (k === "restore") return () => { Object.assign(t, stack.pop() || {}); };
      if (k === "arc") return () => { if (t.globalCompositeOperation === "lighter") log.additiveArcs++; };
      if (k === "fillText") return (s) => log.texts.push(String(s));
      if (k === "fillRect") return (x, y, w, h) => { log.fills.push(t.fillStyle); if (w === 2 && h === 2) log.embers.push([x, y]); };
      if (k === "fill") return () => log.fills.push(t.fillStyle);
      if (k === "measureText") return (s) => ({ width: String(s).length * 6 });
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log, state, depth: () => stack.length };
}

function drawGame(g, opts) {
  const c = stubCanvas();
  const r = RN.createRenderer(c.ctx, null, opts);
  r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: null, time: 1.2 });
  return c;
}

test("auras: MASTERED gold and ULTRA-MAD red, the highest tier decides; stub honours save/restore", () => {
  const plain = quietGame();
  const base = drawGame(plain).log.additiveArcs;
  const gold = quietGame(); gold.skills.score = 6;
  const red = quietGame(); red.skills.score = 7; red.skills.more = 6;
  const goldDraw = drawGame(gold), redDraw = drawGame(red);
  assert.ok(goldDraw.log.additiveArcs > base, "gold aura adds additive circles");
  assert.ok(redDraw.log.additiveArcs > base);
  assert.equal(goldDraw.state.globalCompositeOperation, "source-over", "restore() put the blend mode back");
  assert.ok(goldDraw.log.fills.some((f) => String(f).includes("255,210,60")), "gold");
  assert.ok(redDraw.log.fills.some((f) => String(f).includes("255,70,20")), "red-orange");
  assert.equal(redDraw.log.fills.some((f) => String(f).includes("255,210,60")), false, "the highest tier sets the aura");
});

test("reduced motion keeps auras static", () => {
  const g = quietGame(); g.skills.more = 7;
  const draw = (time, reducedMotion) => {
    const c = stubCanvas();
    const r = RN.createRenderer(c.ctx, null, { reducedMotion });
    r.draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: null, time });
    return JSON.stringify(c.log.embers);
  };
  assert.ok(JSON.parse(draw(1.0, true)).length >= 6, "embers are drawn");
  assert.equal(draw(1.0, true), draw(1.37, true));
  assert.notEqual(draw(1.0, false), draw(1.37, false), "and they move when motion is allowed");
});

test("the picker card screen and the HUD skill row are drawn", () => {
  const g = quietGame();
  g.skills.laser = 3; g.skills.score = 6; g.skills.moons = 7;
  RW.applyCapsule(g, "bronze");
  const { log } = drawGame(g);
  assert.ok(log.texts.includes("CHOOSE A SKILL"));
  for (const f of S.FAMILIES) assert.ok(log.texts.some((t) => t.endsWith(f.name)), f.name);
  assert.ok(log.texts.includes("MASTERED"));
  assert.ok(log.texts.filter((t) => t === "ULTRA-MAD").length >= 1, "ULTRA-MAD badge / greyed card");
});
