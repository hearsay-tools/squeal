import assert from "node:assert/strict";
import { test } from "node:test";
import { helperValue } from "../lib/helper.ts";

test("helper", () => assert.equal(helperValue, "helper-1"));
