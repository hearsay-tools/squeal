import { test } from "node:test";
import assert from "node:assert";
import { add } from "../src/util.mjs";
test("adds", () => assert.equal(add(1, 2), 3));
test("dynamic", async () => { const { mul } = await import("../src/other.mjs"); assert.equal(mul(2, 3), 6); });
