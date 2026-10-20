import { test } from "node:test";
import assert from "node:assert";
test("gone fails", () => { assert.fail("removed project still ran"); });
