import assert from "node:assert/strict";
import { test } from "node:test";
import { extValue } from "ext";

test("ext", () => assert.equal(extValue, "ext+trans-1"));
