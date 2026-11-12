import assert from "node:assert/strict";
import { test } from "node:test";
import { a } from "../src/a.ts";

test("q1", () => {
  assert.equal(a(1), 1);
});
