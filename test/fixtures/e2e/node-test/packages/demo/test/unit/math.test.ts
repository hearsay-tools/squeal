import assert from "node:assert/strict";
import { test } from "node:test";
import { add } from "../../src/math.js";

test("adds", () => {
  assert.equal(add(2, 3), 5);
});

test("sees the preload", () => {
  assert.equal(globalThis.fixturePreload, "preloaded");
  assert.equal(process.env.FIXTURE_PRELOAD, "preloaded");
});
