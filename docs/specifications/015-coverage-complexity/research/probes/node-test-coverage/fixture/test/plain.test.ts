import assert from "node:assert";
import { test } from "node:test";
import { clamp } from "../src/plain.ts";

test("clamp", () => {
  assert.equal(clamp(9, { low: 0, high: 5 }), 5);
});
