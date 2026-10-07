import assert from "node:assert/strict";
import { test } from "node:test";
import { slug } from "@reference/util";

test("the workspace package resolves by name", () => {
  assert.equal(slug("A B"), "a-b");
  assert.equal(process.env.FIXTURE_PRELOAD, "preloaded");
});
