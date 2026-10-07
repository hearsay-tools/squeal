import assert from "node:assert/strict";
import { test } from "node:test";
import { x } from "~/x";

test("paths inherited through extends resolve from the base's directory", () => {
  assert.equal(x, "x");
});
