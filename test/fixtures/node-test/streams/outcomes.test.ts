import assert from "node:assert/strict";
import { before, describe, it, test } from "node:test";

describe("suite", () => {
  it("leaf", () => assert.ok(true));
  describe("inner", () => {
    it("deep", () => assert.ok(true));
  });
  it.skip("skipped", () => {});
  it.todo("todo");
});
describe("hooked", () => {
  before(() => {
    throw new Error("before failed");
  });
  it("behind the hook", () => assert.ok(true));
});
test("parent", async (t) => {
  await t.test("child", () => assert.ok(true));
  await t.test("broken child", () => assert.equal(1, 2));
});
test("own failure", async (t) => {
  await t.test("child ok", () => assert.ok(true));
  throw new Error("parent body failed");
});
test("skip option", { skip: "not here" }, () => {});
test("todo option", { todo: true }, () => {});
test("failing todo", { todo: true }, () => {
  throw new Error("not yet");
});
test("same", () => assert.ok(true));
test("same", () => assert.ok(true));
