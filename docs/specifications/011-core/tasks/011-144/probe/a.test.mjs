import { describe, it, test } from "node:test";
import assert from "node:assert";
describe("parity", () => {
  it("old 1", () => {});
  it("new 1", () => { assert.fail("red"); });
  describe("inner", () => { it("new 2", () => {}); });
});
test("new 3 top", () => {});
