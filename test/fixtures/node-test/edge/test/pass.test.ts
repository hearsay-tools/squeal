import assert from "node:assert/strict";
import { test } from "node:test";
import { lib } from "@edge/lib";

test("passes", () => assert.equal(lib(), "lib"));
