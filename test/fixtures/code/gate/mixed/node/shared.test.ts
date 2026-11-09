import assert from "node:assert/strict";
import { test } from "node:test";
import { fromNode } from "../src/shared.ts";

const twice = (x: number): number => fromNode(x);

test("from node:test", () => {
  assert.equal(twice(3), 6);
});
