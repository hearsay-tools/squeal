import { test } from "node:test";
import assert from "node:assert";
import { clamp } from "./math.ts";

test("clamp", () => {
  assert.equal(clamp(99, 0, 10), 10);
});
