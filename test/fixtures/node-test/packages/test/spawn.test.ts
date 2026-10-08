import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("spawn", () => assert.equal(execFileSync(process.execPath, ["-p", "1"]).toString().trim(), "1"));
