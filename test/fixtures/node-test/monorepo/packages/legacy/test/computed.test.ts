import assert from "node:assert/strict";
import { test } from "node:test";

const name = ["..", "src", "target.cjs"].join("/");

test("a computed require loads a file no static scan sees", () => {
  assert.equal(require(name).target, "target");
});
