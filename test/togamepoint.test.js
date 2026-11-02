import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";

const IN = globalThis.BBInput;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + " vs " + b);

test("toGamePoint: a box taller than the aspect scales both axes by 480 / width", () => {
  const [x, y] = IN.toGamePoint(195, 422, { left: 0, top: 0, width: 390, height: 844 });
  near(x, 240); assert.ok(Math.abs(y - 519.4) < 0.05, y + " vs 519.4");
});

test("toGamePoint: a 480x640 box maps one to one", () => {
  const [x, y] = IN.toGamePoint(240, 320, { left: 0, top: 0, width: 480, height: 640 });
  near(x, 240); near(y, 320);
});

test("toGamePoint: subtracts the box offset first", () => {
  const [x, y] = IN.toGamePoint(250, 340, { left: 10, top: 20, width: 480, height: 640 });
  near(x, 240); near(y, 320);
});

test("toGamePoint: a tap on the Sound section's Back row hits Back on a 390x844 phone", () => {
  const m = IN.createMenu({ screen: "title" });
  m.openSettings();
  m.activate(2);
  assert.equal(m.section, "sound");
  const back = m.settingsRows().length - 1, L = m.settingsLayout();
  const gx = L.x + L.w / 2, gy = L.y + back * (L.h + L.gap) + L.h / 2, k = 390 / 480;
  const [x, y] = IN.toGamePoint(gx * k, gy * k, { left: 0, top: 0, width: 390, height: 844 });
  assert.equal(m.itemAt(x, y), back);
});
