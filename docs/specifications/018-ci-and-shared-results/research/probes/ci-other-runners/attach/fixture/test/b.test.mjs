import { test, describe } from "node:test";
import assert from "node:assert";
import { add } from "../src/util.mjs";
describe("suite", () => { test("adds again", () => assert.equal(add(2, 2), 4)); test.skip("skipped", () => {}); });
