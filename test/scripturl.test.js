import { test } from "node:test";
import assert from "node:assert/strict";

// regression test for the CodeQL js/xss-through-dom fix: game.js writes <script> tags for enemies.js and
// skills.js from its own URL, and a crafted URL must not break out of the src attribute
test("game.js HTML-escapes its own script URL before document.write", async () => {
  const writes = [];
  globalThis.document = {
    currentScript: { src: 'https://x.test/"><img src=x onerror=alert(1)>/game.js' },
    write: (s) => writes.push(s),
  };
  await import("../src/game.js");
  assert.equal(writes.length, 2);
  for (const w of writes) {
    assert.ok(!w.includes('"><img'), w);
    assert.ok(w.includes("&quot;&gt;&lt;img"), w);
    const head = '<script src="', tail = '"></script>';
    assert.ok(w.startsWith(head) && w.endsWith(tail), w);
    const url = w.slice(head.length, -tail.length);
    for (const c of ['"', "<", ">"]) assert.ok(!url.includes(c), w);
  }
});
