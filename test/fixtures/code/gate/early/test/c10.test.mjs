import assert from "node:assert/strict";
import { test } from "node:test";
import { SHARED } from "../src/shared.mjs";

test("shared", () => {
  assert.equal(SHARED, 2);
});
