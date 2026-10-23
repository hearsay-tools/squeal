import { test } from "node:test";
import assert from "node:assert";
import { add } from "./math.ts";

test("add", () => {
  assert.equal(add(1, 2), 3);
});
