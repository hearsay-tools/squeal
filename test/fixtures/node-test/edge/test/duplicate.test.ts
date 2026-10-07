import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

describe("suite", () => {
  it("same name", () => assert.ok(true));
  it("same name", () => assert.ok(true));
});
test("same name", () => assert.ok(true));
test("same name", () => assert.ok(true));
