import assert from "node:assert/strict";
import { test } from "node:test";

test("keep runs with PROBE_MODE a", () => {
  assert.equal(process.env.PROBE_MODE, "a");
});
