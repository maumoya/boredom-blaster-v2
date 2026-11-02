import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/ui.js";
import "../src/render.js";

const IN = globalThis.BBInput;
const zero = { x: 0, y: 0 };
const rig = () => {
  const touch = IN.createTouch(false);
  return { touch, mouse: IN.createMouse(touch), keyboard: IN.createKeyboard() };
};

test("nothing held: every axis is exactly 0", () => {
  const { touch, keyboard } = rig();
  const pad = IN.createGamepad({ getPads: () => [] });
  assert.deepEqual(touch.axes(), zero);
  assert.deepEqual(keyboard.axes(), zero);
  assert.deepEqual(pad.axes(), zero);
});

test("pad axes inside the 0.2 dead zone read 0", () => {
  const p = { connected: true, axes: [0.19, -0.19], buttons: [] };
  const pad = IN.createGamepad({ getPads: () => [p] });
  pad.poll();
  assert.deepEqual(pad.axes(), zero);
});

test("releaseAll clears a stick whose pointer never ended, a held mouse and held keys", () => {
  const r = rig();
  r.touch.start(7, 100, 400);
  r.touch.move(7, 160, 400);
  assert.ok(r.touch.axes().x > 0);
  r.keyboard.keydown("ArrowLeft");
  IN.releaseAll(r);
  assert.deepEqual(r.touch.axes(), zero);
  assert.deepEqual(r.keyboard.axes(), zero);

  r.mouse.down(100, 400, 0);
  r.mouse.move(150, 400);
  assert.ok(r.touch.axes().x > 0);
  IN.releaseAll(r);
  assert.deepEqual(r.touch.axes(), zero);
  assert.equal(r.mouse.isDown(), false);
});

test("two thumbs: ending the FIRE pointer (up, then lostpointercapture) keeps the stick", () => {
  const { touch } = rig();
  touch.start(1, 100, 400);
  touch.move(1, 150, 400);
  const before = touch.axes();
  touch.start(2, IN.BUTTONS.fire.x, IN.BUTTONS.fire.y);
  assert.ok(touch.fire());
  touch.end(2); // pointerup
  touch.end(2); // lostpointercapture
  assert.equal(touch.fire(), false);
  assert.deepEqual(touch.axes(), before);
  assert.ok(before.x > 0);
});

test("index.html: dvh, safe area, iOS web app metas", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /height: 100vh; height: 100dvh/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-top\)/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
});

test("main.js wires lostpointercapture, blur, visibility, screen and picker changes", () => {
  const js = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(js, /"lostpointercapture"/);
  assert.match(js, /addEventListener\("blur"/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /menu\.screen !== lastScreen/);
  assert.match(js, /pickerOpen && !wasPickerOpen/);
});

test("How to play has the Add to Home Screen line", () => {
  assert.ok(globalThis.BBRender.HOW_TO.includes("iPhone: Share › Add to Home Screen for full screen"));
});
