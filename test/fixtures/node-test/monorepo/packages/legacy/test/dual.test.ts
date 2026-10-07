import assert from "node:assert/strict";
import { test } from "node:test";
import { dual } from "@mono/dual";

test("an import in a CommonJS-typed package takes the require condition under tsx", () => {
  assert.equal(dual, "cjs");
});
