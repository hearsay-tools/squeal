import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../../src/greet.mjs";

test("greets by name", () => {
  assert.equal(greet("ada"), "hello, ada");
});
