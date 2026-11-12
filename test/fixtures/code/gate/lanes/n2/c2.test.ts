import assert from "node:assert/strict";
import { test } from "node:test";
import { c } from "../src/c.ts";

test("c2", () => {
  assert.equal(c(1), 1);
});
