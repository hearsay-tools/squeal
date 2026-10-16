// Imports the built package entry: without dist/ the whole file fails to load.
import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../../dist/index.js";

test("the built entry exports greet", () => {
  assert.equal(greet("ada"), "hello, ada");
});
