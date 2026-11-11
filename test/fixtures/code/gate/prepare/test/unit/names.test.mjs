import test from "node:test";
import assert from "node:assert/strict";
import { label } from "../../src/names.mjs";

test("label", () => assert.equal(label("cez", false), "cez"));
