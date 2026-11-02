import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";

const BB = globalThis.BB, S = globalThis.BBSkills, RW = globalThis.BBRewards, IN = globalThis.BBInput;
const mk = (x, y, extra) => ({ x, y, w: BB.DRONE.w, h: BB.DRONE.h, ...extra });
const newGame = () => { const g = BB.createGame({ rng: () => 0.5 }); g.drones = [mk(0, 60)]; return g; };
const shipCx = (g) => g.ship.x + g.ship.w / 2;
// a column of n enemies straight above the ship, spaced 40 px apart (nearest first)
const stack = (g, n) => Array.from({ length: n }, (_, i) => mk(shipCx(g) - 14, g.ship.y - 40 * (i + 1), { hp: 100, maxHp: 100 }));
const step = (g, secs, dt = 0.05) => { for (let t = 0; t < secs - 1e-9; t += dt) BB.update(g, dt, {}); };

test("laser: needs the skill, lasts 1.5 s, 9 s cooldown", () => {
  const g = newGame();
  assert.equal(BB.laser(g), false, "not owned");
  g.skills.laser = 1;
  assert.equal(BB.laser(g), true);
  assert.equal(g.laserCooldown, 9);
  assert.equal(BB.laser(g), false, "still firing");
  step(g, 1.4);
  assert.ok(g.laserBeam, "beam still on at 1.4 s");
  step(g, 0.2);
  assert.equal(g.laserBeam, null, "beam off after 1.5 s");
  assert.equal(BB.laser(g), false, "cooling down");
  step(g, 4.5);
  assert.equal(BB.laser(g), false, "still cooling at 6 s");
  step(g, 3);
  assert.equal(BB.laser(g), true, "ready after 9 s");
});

test("laser: crosses 1 to 5 enemies at levels 1 to 5", () => {
  for (let lvl = 1; lvl <= 5; lvl++) {
    const g = newGame();
    g.skills.laser = lvl;
    g.drones = stack(g, 8);
    BB.laser(g);
    BB.update(g, 0.1, {});
    assert.equal(g.drones.filter((d) => d.hp < 100).length, lvl, "level " + lvl);
  }
});

test("laser: MASTERED has 2 beams, ULTRA-MAD 3, gold and red; each beam crosses everything in its column", () => {
  for (const [t, n] of [[6, 2], [7, 3]]) {
    const g = newGame();
    g.skills.laser = t;
    BB.laser(g);
    assert.equal(g.laserBeam.cols.length, n);
    const xs = BB.laserColumns(g);
    g.drones = [];
    for (const cx of xs) g.drones.push(...Array.from({ length: 6 }, (_, i) => mk(cx - 14, g.ship.y - 40 * (i + 1), { hp: 100, maxHp: 100 })));
    BB.update(g, 0.1, {});
    assert.equal(g.drones.filter((d) => d.hp < 100).length, 6 * n, "tier " + t);
  }
});

test("laser: kills a plain drone and a mini-boss takes boss damage each tick", () => {
  const g = newGame();
  g.skills.laser = 1;
  g.drones = [mk(shipCx(g) - 14, g.ship.y - 60), mk(0, 60)]; // the spare keeps the wave from ending
  BB.laser(g);
  BB.update(g, 0.1, {});
  assert.equal(g.drones.length, 1);
  assert.equal(g.kills, 1);
  const h = newGame();
  h.skills.laser = 1;
  h.drones = [mk(shipCx(h) - 14, h.ship.y - 80, { hp: 40, maxHp: 40, boss: true })];
  BB.laser(h);
  BB.update(h, 0.1, {});
  assert.equal(h.drones[0].hp, 40 - BB.LASER.bossDamage);
  Object.assign(h.drones[0], { x: shipCx(h) - 14, y: h.ship.y - 80 }); // the formation marches; keep it in the beam
  BB.update(h, 0.1, {});
  assert.equal(h.drones[0].hp, 40 - 2 * BB.LASER.bossDamage);
});

test("moons: count per tier and hits to break", () => {
  for (let t = 1; t <= 7; t++) {
    const g = newGame();
    g.skills.moons = t;
    BB.update(g, 0.01, {});
    assert.equal(g.moons.length, t);
    assert.ok(g.moons.every((m) => m.hp === m.max));
    assert.equal(g.moons[0].max, t >= 7 ? 7 : t >= 6 ? 5 : 3);
  }
  assert.equal(S.moonCount(6), 6);
});

test("moons: destroy enemies and enemy bullets on contact and break after their hits", () => {
  const g = newGame();
  g.skills.moons = 1;
  BB.update(g, 0.01, {});
  const place = (o) => { const p = BB.moonPos(g, 0); return { ...o, x: p.x - (o.w - p.w) / 2, y: p.y - (o.h - p.h) / 2 }; };
  g.drones = [place(mk(0, 0)), mk(0, 60)]; // the orbit barely moves in 1 ms; the spare keeps the wave from ending
  BB.update(g, 0.001, {});
  assert.equal(g.drones.length, 1, "enemy destroyed");
  assert.equal(g.moons[0].hp, 2);
  g.enemyBullets = [place({ w: 4, h: 12, vx: 0, vy: 0 })];
  BB.update(g, 0.001, {});
  assert.equal(g.enemyBullets.length, 0, "bullet destroyed");
  assert.equal(g.moons[0].hp, 1);
  g.drones = [place(mk(0, 0)), mk(0, 60)];
  BB.update(g, 0.001, {});
  assert.equal(g.moons[0].hp, 0, "broken after 3 hits");
  g.drones = [place(mk(0, 0)), mk(0, 60)];
  BB.update(g, 0.001, {});
  assert.equal(g.drones.length, 2, "a broken moon does nothing");
});

test("moons: broken ones regrow at the next wave", () => {
  const g = newGame();
  g.skills.moons = 3;
  BB.update(g, 0.01, {});
  g.moons.forEach((m) => { m.hp = 0; });
  g.drones = [];
  BB.update(g, 0.01, {});
  assert.equal(g.wave, 2);
  assert.ok(g.moons.length === 3 && g.moons.every((m) => m.hp === 3));
});

test("moons: an upgrade adds a moon at once", () => {
  const g = newGame();
  g.skills.moons = 1;
  BB.update(g, 0.01, {});
  S.upgrade(g, "moons");
  BB.update(g, 0.01, {});
  assert.equal(g.moons.length, 2);
});

test("Magneto: pulls capsules inside its columns, tier by tier", () => {
  for (let t = 0; t <= 6; t++) {
    const g = newGame();
    g.skills.magneto = t;
    g.ship.x = 240;
    // a capsule 100 px right of the ship's centre: column 3 (2 px past 96)
    const c = RW.spawnCapsule(g, shipCx(g) + 100, 100, "bronze");
    const x0 = c.x + c.w / 2;
    RW.updateCapsules(g, 0.1, BB.hit, BB.H);
    const pulled = Math.abs(c.x + c.w / 2 - x0) > 1e-6;
    assert.equal(pulled, t >= 3, "tier " + t);
  }
});

test("Magneto: ULTRA-MAD pulls twice as fast and bends enemy bullets within 30 px", () => {
  const speed = (t) => {
    const g = newGame();
    g.skills.magneto = t;
    const c = RW.spawnCapsule(g, shipCx(g) + 40, g.ship.y - 300, "bronze");
    const x0 = c.x;
    RW.updateCapsules(g, 0.1, BB.hit, BB.H);
    return Math.abs(c.x - x0);
  };
  assert.ok(speed(7) > speed(6) * 1.5);
  const g = newGame();
  g.skills.magneto = 7;
  g.enemyBullets = [{ x: shipCx(g) + 10, y: g.ship.y - 10, w: 4, h: 12, vx: 0, vy: 0 }];
  BB.update(g, 0.02, {});
  assert.ok(g.enemyBullets.length === 0 || g.enemyBullets[0].vx > 0, "pushed right, away from the ship");
  const h = newGame();
  h.skills.magneto = 6;
  h.enemyBullets = [{ x: shipCx(h) + 10, y: h.ship.y - 10, w: 4, h: 12, vx: 0, vy: 0 }];
  BB.update(h, 0.02, {});
  assert.equal(h.enemyBullets[0] ? h.enemyBullets[0].vx : 0, 0, "MASTERED does not bend");
});

test("twin ship: at most 2 charges, 15 s, fires the full pattern, absorbs one hit", () => {
  const g = newGame();
  g.superStar = 5;
  for (let i = 0; i < 4; i++) RW.applyCapsule(g, "rainbow");
  assert.equal(g.twinCharges, 2);
  assert.equal(BB.twin(g), true);
  assert.equal(g.twinCharges, 1);
  assert.equal(BB.twin(g), false, "one twin at a time");
  g.skills.more = 3;
  BB.shoot(g);
  assert.equal(g.bullets.length, 6, "the twin fires the full pattern too");
  const tw = BB.twinRect(g);
  assert.equal(Math.abs(tw.x - g.ship.x), 40);
  g.superStar = 0; g.bullets = [];
  step(g, 14.9);
  assert.ok(g.twin, "still there at 14.9 s");
  step(g, 0.2);
  assert.equal(g.twin, null, "gone after 15 s");

  const h = newGame();
  h.twinCharges = 1;
  BB.twin(h);
  const r = BB.twinRect(h);
  h.enemyBullets = [{ x: r.x + 10, y: r.y, w: 4, h: 12, vx: 0, vy: 0 }];
  BB.update(h, 0.01, {});
  assert.equal(h.twin, null, "leaves after its one hit");
  assert.ok(h.twinFlash, "in a flash");
  assert.equal(h.lives, BB.START_LIVES, "the ship took nothing");
  assert.equal(h.enemyBullets.length, 0);
});

test("LASER and TWIN: keys queue the actions, touch buttons exist only when owned", () => {
  IN.takeActions();
  const k = IN.createKeyboard();
  k.keydown("KeyK"); k.keydown("KeyL");
  assert.deepEqual(IN.takeActions(), { laser: true, twin: true });
  assert.deepEqual(IN.takeActions(), { laser: false, twin: false });

  const t = IN.createTouch(false);
  assert.deepEqual(Object.keys(t.extraButtons()), []);
  const b = IN.EXTRA_BUTTONS.laser;
  t.start(1, b.x, b.y);
  assert.equal(IN.takeActions().laser, false, "not owned: the tap does nothing");
  t.end(1);
  t.setOwned({ laser: true, twin: true });
  assert.deepEqual(Object.keys(t.extraButtons()).sort(), ["laser", "twin"]);
  t.start(2, b.x, b.y);
  assert.equal(IN.takeActions().laser, true);
  t.end(2);
  const w = IN.EXTRA_BUTTONS.twin;
  t.start(3, w.x, w.y);
  assert.equal(IN.takeActions().twin, true);

  const g = newGame();
  g.skills.laser = 1;
  IN.createKeyboard().keydown("KeyK");
  BB.update(g, 0.01, {});
  assert.ok(g.laserBeam, "the queued key fires the laser through update");
});
