import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("math", () => {
  test("adds", () => {
    assert.equal(1 + 1, 2);
  });
  test("subtracts", () => {
    assert.equal(3 - 1, 1);
  });
  test.skip("divides", () => {});
  test("adds", () => {
    assert.equal(2 + 2, 4);
  });
});
