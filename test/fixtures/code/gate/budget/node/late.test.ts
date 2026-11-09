import assert from "node:assert/strict";
import { test } from "node:test";
import { late } from "../src/a.ts";

test("late", () => {
  assert.equal(late(1), 4);
});
