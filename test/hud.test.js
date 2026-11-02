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
import "../src/render.js";

const BB = globalThis.BB, IN = globalThis.BBInput, RN = globalThis.BBRender, S = globalThis.BBSkills;

// Stub canvas: records fillText calls (string, x, y, size) and arc centres (x, y).
function recorder() {
  const texts = [], arcs = [], target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "fillText") return (s, x, y) => { texts.push({ s, x, y, font: t.font }); };
      if (k === "arc") return (x, y, r) => { arcs.push({ x, y, r }); };
      return () => undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, texts, arcs };
}

function drawWith(layoutOpts, setup) {
  const g = BB.createGame({ rng: () => 0.5 });
  g.drones = [];
  if (setup) setup(g);
  const touch = IN.createTouch();
  touch.setLayout(IN.layoutFor(layoutOpts));
  const c = recorder();
  RN.createRenderer(c.ctx, null).draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch, time: 1 });
  return { ...c, g, touch };
}

const hit = (b) => ({ x0: b.x - b.r * IN.HIT_SCALE, x1: b.x + b.r * IN.HIT_SCALE, y0: b.y - b.r * IN.HIT_SCALE, y1: b.y + b.r * IN.HIT_SCALE });
const overlapsAny = (box, buttons) => Object.values(buttons).some((b) => {
  const h = hit(b);
  return box.x0 < h.x1 && box.x1 > h.x0 && box.y0 < h.y1 && box.y1 > h.y0;
});

test("top panel: row 1 shows only the big centred score plus lives; the wave sits on row 2", () => {
  const { texts } = drawWith({ zone: "overlay" }, (g) => { g.score = 1234; g.wave = 7; });
  const score = texts.find((t) => t.s === "001234");
  assert.ok(score && score.x === 240 && score.y < 40);
  assert.ok(/(\d+)px/.exec(score.font)[1] >= 22, "large");
  const wave = texts.find((t) => t.s === "WAVE 7");
  assert.ok(wave && wave.y > 40 && wave.y <= 60, "the wave is on row 2 of the top panel");
  assert.ok(!texts.some((t) => t.s.startsWith("BEST") || t.s === "SCORE"));
  for (const t of texts.filter((x) => x.y < IN.PAUSE_BUTTON.y + 30)) assert.ok(["001234", "×3"].includes(t.s) || /×/.test(t.s), t.s);
});

test("pause and mute keep their hit areas", () => {
  assert.ok(IN.pauseHit(IN.PAUSE_BUTTON.x + 5, IN.PAUSE_BUTTON.y + 5));
  assert.ok(globalThis.BBAudio.speakerHit(globalThis.BBAudio.SPEAKER.x, globalThis.BBAudio.SPEAKER.y));
});

test("top panel row 2: wave, pips, shield and BOOM on one line inside the panel, clear of every control", () => {
  const { texts, arcs, touch } = drawWith({ zone: "overlay", dpad: true }, (g) => { g.skills.laser = 2; g.shield = 2; g.kaboomCharges = 1; });
  const y = 44;
  const wave = texts.find((t) => t.s.startsWith("WAVE"));
  assert.ok(Math.abs(wave.y - (y + 4)) < 1e-6);
  const L = touch.layout();
  const buttons = { ...L.buttons, ...touch.extraButtons() };
  if (L.dpad) buttons.dpad = L.dpad;
  const dots = arcs.filter((a) => Math.abs(a.y - y) < 1e-6);
  assert.ok(dots.length >= BB.R().SHIELD.max + BB.KABOOM.maxCharges, "shield and BOOM pips sit on the line");
  for (const d of dots) assert.ok(d.x + d.r <= 476 && !overlapsAny({ x0: d.x - d.r, x1: d.x + d.r, y0: d.y - d.r, y1: d.y + d.r }, buttons), "pip at " + d.x);
});

test("picker: a card not in picker.offered is greyed with LOCKED, and the outline never lands on it", () => {
  const g = BB.createGame({ rng: () => 0.5 });
  g.drones = [];
  g.picks = 1;
  S.openPicker(g, ["laser", "score"]);
  const ids = S.IDS;
  assert.equal(ids[g.picker.cursor], "laser");
  const c = recorder();
  RN.createRenderer(c.ctx, null).draw({ game: g, menu: IN.createMenu({ screen: "playing" }), best: 0, touch: null, time: 1 });
  assert.equal(c.texts.filter((t) => t.s === "LOCKED").length, ids.length - 2);
  for (let i = 0; i < 6; i++) { S.moveCursor(g, 1); assert.ok(g.picker.offered.includes(ids[g.picker.cursor])); }
  assert.equal(S.pickerTap(g, S.cardRect(ids.indexOf("more")).x + 5, S.cardRect(ids.indexOf("more")).y + 5), true);
  assert.ok(g.picker, "tapping a locked card picks nothing");
  g.picker = null;
});
