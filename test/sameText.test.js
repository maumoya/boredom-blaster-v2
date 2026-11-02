import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/scores.js";
import { sameText } from "../worker/scores.js";

// secrets are compared through fixed-size digests, so how long the check takes says nothing about the secret
test("sameText matches only identical strings, whatever their lengths", async () => {
  assert.equal(await sameText("Bearer k-test", "Bearer k-test"), true);
  for (const other of ["", "B", "Bearer k-tesT", "Bearer k-test ", "bearer k-test", "Bearer k-test-longer"]) {
    assert.equal(await sameText(other, "Bearer k-test"), false, JSON.stringify(other));
  }
  assert.equal(await sameText(null, "x"), false);
});
