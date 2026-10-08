import assert from "node:assert/strict";
import { test } from "node:test";
import { localValue } from "../lib/local.ts";

test("plain", () => assert.equal(localValue, "local"));
