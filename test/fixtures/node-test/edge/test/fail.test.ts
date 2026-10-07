import assert from "node:assert/strict";
import { test } from "node:test";

test("passes beside the failure", () => assert.equal(1, 1));
test("fails", () => assert.equal(1, 2));
