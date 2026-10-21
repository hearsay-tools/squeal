import assert from "node:assert/strict";
import { test } from "node:test";

test("gone fails", () => {
  assert.fail("removed or renamed project still ran");
});
