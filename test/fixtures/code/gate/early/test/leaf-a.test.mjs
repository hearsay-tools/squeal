import assert from "node:assert/strict";
import { test } from "node:test";
import { leaf } from "../src/leaf.mjs";

test("leaf", () => {
  assert.equal(leaf(1), 1);
});
