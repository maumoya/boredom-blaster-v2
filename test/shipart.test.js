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

const BB = globalThis.BB, AS = globalThis.BBAssets, RN = globalThis.BBRender, IN = globalThis.BBInput;

// A recording 2d context. Every call is logged; gradients are real-looking objects.
function recCtx(log) {
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => {
        log.push(k);
        if (k === "createLinearGradient" || k === "createRadialGradient") return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function setup() {
  const made = []; // every offscreen canvas, with its own draw log
  const makeCanvas = (w, h) => {
    const log = [];
    const canvas = { width: w, height: h, log, getContext: () => recCtx(log) };
    made.push(canvas);
    return canvas;
  };
  const mainLog = [];
  const ctx = recCtx(mainLog);
  const renderer = RN.createRenderer(ctx, null, { makeCanvas });
  return { made, mainLog, renderer };
}

function gameWith(species) {
  const g = BB.createGame({ rng: () => 0.5 });
  const E = BB.E();
  g.drones = species.map((sp, i) => {
    const d = E.createEnemy(g, sp, 20 + i * 50, 80);
    d.entry = null; d.delay = 0;
    return d;
  });
  return g;
}
const view = (game) => ({ game, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: null, time: 1 });

test("player and every enemy type draw from their own routine, not from Kenney images", () => {
  const types = ["player", ...Object.keys(BB.E().SPECIES)];
  for (const t of types) assert.equal(typeof AS.SHIP_ART[t].draw, "function", t);
  assert.equal(new Set(types.map((t) => AS.SHIP_ART[t].draw)).size, types.length - 1, "only splitling shares a routine");
  const g = gameWith(Object.keys(BB.E().SPECIES));
  const { renderer, made } = setup();
  // an assets object that would hand out images: the ships must ignore it
  const asked = [];
  const spy = { get: (name) => { asked.push(name); return null; }, failed: () => [] };
  const log = [];
  const r2 = RN.createRenderer(recCtx(log), spy, { makeCanvas: (w, h) => ({ width: w, height: h, getContext: () => recCtx([]) }) });
  r2.update(0.016, g); r2.draw(view(g));
  for (const n of ["ship", "shipDamage1", "drone", "wasp", "viper", "diver", "splitter", "splitling", "orbiter", "dasher"]) {
    assert.ok(!asked.includes(n), n + " must not come from an image");
  }
  renderer.update(0.016, g); renderer.draw(view(g));
  assert.equal(made.length, new Set(g.drones.map((d) => d.species)).size + 1, "one canvas per type, plus the player");
});

test("each ship is drawn once per type and tint; later frames reuse the cache", () => {
  const g = gameWith(["drone", "wasp", "viper", "diver", "splitter", "orbiter", "dasher"]);
  const { renderer, made } = setup();
  renderer.update(0.016, g); renderer.draw(view(g));
  const first = made.length;
  assert.equal(first, 8, "7 enemy types + the player");
  const drawsAfterFirst = made.map((c) => c.log.length);
  for (let i = 0; i < 5; i++) { renderer.update(0.016, g); renderer.draw(view(g)); }
  assert.equal(made.length, first, "no new offscreen canvas on later frames");
  assert.deepEqual(made.map((c) => c.log.length), drawsAfterFirst, "no ship was redrawn into its cache");
});

test("createShipArt counts renders and hits, and keys the cache on type, tint and damage", () => {
  const art = AS.createShipArt((w, h) => ({ width: w, height: h, getContext: () => recCtx([]) }));
  const ctx = recCtx([]);
  art.draw(ctx, "wasp", 10, 10, 40);
  art.draw(ctx, "wasp", 50, 50, 40);
  assert.deepEqual({ ...art.stats }, { renders: 1, hits: 1 });
  art.draw(ctx, "wasp", 10, 10, 40, { accent: AS.NEON.lime });
  assert.equal(art.stats.renders, 2, "a new tint renders again");
  art.draw(ctx, "player", 10, 10, 40, { dmg: 0 });
  art.draw(ctx, "player", 10, 10, 40, { dmg: 2 });
  assert.equal(art.stats.renders, 4, "damage states are separate cache entries");
});

// one ctx.transform(scale, 0, 0, scale, x, y) places and scales the ship, the same as translate + scale
for (const [name, makeCanvas] of [["missing", null], ["returning null", () => null]]) {
  test("makeCanvas " + name + ": ships still draw straight onto the target context", () => {
    const log = [];
    const art = AS.createShipArt(makeCanvas);
    art.draw(recCtx(log), "dasher", 100, 100, 80);
    assert.ok(log.includes("fill"), "the ship is filled onto the target");
    assert.ok(log.includes("transform") || log.includes("translate"), "the ship is placed on the target");
    assert.equal(art.stats.renders, 0, "the cache render counter stays 0");
    assert.equal(log.includes("drawImage"), false);
  });
}

test("the neon palette and per-type accents come from the spec", () => {
  assert.deepEqual(AS.NEON, { cyan: "#22E5FF", magenta: "#FF2BD6", lime: "#6CFF3A", orange: "#FF7A1A", yellow: "#FFE53B" });
  assert.equal(AS.SHIP_ART.player.accent, "#22E5FF");
  const pal = new Set(Object.values(AS.NEON));
  for (const [t, a] of Object.entries(AS.SHIP_ART)) assert.ok(pal.has(a.accent), t);
  assert.ok(AS.SHIP_ART.orbiter.aspect < 1 && AS.SHIP_ART.dasher.aspect < 1);
});

test("damage states still show: each lost life draws more marks on the player ship", () => {
  const sizes = [];
  for (const lives of [3, 2, 1]) {
    const g = BB.createGame({ rng: () => 0.5 });
    g.drones = []; g.lives = lives; g.invuln = 0;
    const { renderer, made } = setup();
    renderer.update(0.016, g); renderer.draw(view(g));
    assert.equal(made.length, 1, "lives " + lives);
    sizes.push(made[0].log.length);
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], "draw calls grow with damage: " + sizes);
});

test("hit boxes are unchanged by the new art", () => {
  const E = BB.E().SPECIES;
  const g = gameWith(["orbiter"]);
  const before = { x: g.drones[0].x, y: g.drones[0].y, w: g.drones[0].w, h: g.drones[0].h };
  const { renderer } = setup();
  renderer.update(0.016, g); renderer.draw(view(g));
  assert.deepEqual({ x: g.drones[0].x, y: g.drones[0].y, w: g.drones[0].w, h: g.drones[0].h }, before);
  assert.deepEqual([E.orbiter.w, E.orbiter.h, E.dasher.w, E.dasher.h], [64, 40, 72, 36]);
});
