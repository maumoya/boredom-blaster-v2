import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const BB = globalThis.BB, IN = globalThis.BBInput, RN = globalThis.BBRender, UI = globalThis.BBUI;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("index.html has a device-width viewport meta", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  assert.match(html, /<meta name="viewport" content="[^"]*width=device-width[^"]*initial-scale=1/);
});

function fakeHd(cssW, cssH, ratio) {
  const env = { w: cssW, h: cssH, r: ratio };
  const ctx = { transforms: [], setTransform(...a) { this.transforms.push(a); } };
  const canvas = { width: 0, height: 0 };
  const hd = IN.createHd(canvas, ctx, { css: () => ({ width: env.w, height: env.h }), ratio: () => env.r });
  return { env, ctx, canvas, hd };
}

test("backing store is CSS size x ratio, 4 capped to 3, game width stays 480", () => {
  for (const [ratio, scale] of [[1, 1], [2, 2], [3, 3], [4, 3]]) {
    const { canvas, ctx, hd } = fakeHd(375, 500, ratio);
    hd.sync();
    assert.equal(canvas.width, 375 * scale, "ratio " + ratio);
    assert.equal(canvas.height, 500 * scale);
    const [a, , , d] = ctx.transforms.at(-1);
    assert.ok(Math.abs(a * BB.W - canvas.width) < 1e-9, "480 game units span the backing width");
    assert.equal(a, d);
  }
});

test("a resize or ratio change redoes the backing store; a steady frame does not", () => {
  const { env, canvas, hd } = fakeHd(300, 400, 2);
  assert.equal(hd.sync(), true);
  assert.equal(hd.sync(), false);
  env.w = 360; env.h = 480;
  assert.equal(hd.sync(), true);
  assert.equal(canvas.width, 720);
  env.r = 3;
  assert.equal(hd.sync(), true);
  assert.equal(canvas.width, 1080);
});

test("slow frames step the scale down to 2 and then 1.5, never lower", () => {
  const { canvas, hd } = fakeHd(400, 500, 3);
  hd.sync();
  assert.equal(canvas.width, 1200);
  for (let i = 0; i < 200; i++) hd.frame(0.05);
  assert.equal(hd.quality.cap(), 1.5);
  assert.equal(canvas.width, 600);
  const q = IN.createQuality();
  const caps = [q.cap()];
  for (let i = 0; i < 500; i++) if (q.frame(0.05)) caps.push(q.cap());
  assert.deepEqual(caps, [3, 2, 1.5]);
});

test("fast frames and isolated hitches do not step down", () => {
  const q = IN.createQuality();
  for (let i = 0; i < 500; i++) q.frame(i % 10 === 0 ? 0.2 : 0.016);
  assert.equal(q.cap(), 3);
});

test("a ratio of 1 never scales up; pointer mapping stays in game units", () => {
  assert.equal(IN.hdScale(1, 1.5), 1);
  assert.equal(IN.hdScale(undefined, 3), 1);
  // main.js maps with BB.W / shown width, whatever the backing size is
  const rectW = 375, clientX = 187.5;
  assert.equal(clientX * (BB.W / rectW), 240);
});

test("no monospace font is left in src", () => {
  for (const f of readdirSync(join(root, "src")).filter((n) => n.endsWith(".js"))) {
    assert.doesNotMatch(readFileSync(join(root, "src", f), "utf8"), /monospace/i, f);
  }
  assert.doesNotMatch(UI.FONT, /monospace/);
});

test("the neon palette is shared by buttons, menus and the HUD", () => {
  const N = UI.NEON;
  assert.equal(UI.PALETTE.idle.edge, N.cyan);
  assert.equal(UI.PALETTE.pressed.edge, N.magenta);
  const used = new Set();
  const target = { canvas: { width: 1440, height: 1920 } };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set(t, k, v) { used.add(v); t[k] = v; return true; },
  });
  const menu = IN.createMenu({ screen: "title" });
  RN.createRenderer(ctx, null).draw({ game: BB.createGame(), menu, best: 5, time: 1 });
  for (const c of [N.cyan, N.yellow, N.red]) assert.ok(used.has(c), c);
});

test("every screen draws on a stub canvas at devicePixelRatio 3", () => {
  const ratio = 3;
  const target = { canvas: { width: 480 * ratio, height: 640 * ratio } };
  const ctx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => undefined), set: (t, k, v) => ((t[k] = v), true) });
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const r = RN.createRenderer(ctx, null);
  for (const screen of ["title", "playing", "pause", "scores", "howto", "settings", "results"]) {
    const menu = IN.createMenu({ screen });
    const game = BB.createGame();
    assert.doesNotThrow(() => r.draw({ game, menu, best: 9, time: 2, scores: [], results: null, tab: "device", net: { status: "offline", list: [] } }), screen);
  }
  const menu = IN.createMenu({ screen: "initials" });
  assert.doesNotThrow(() => r.draw({ game: BB.createGame(), menu, best: 1, time: 1, picker: IN.createInitialsPicker() }));
});
