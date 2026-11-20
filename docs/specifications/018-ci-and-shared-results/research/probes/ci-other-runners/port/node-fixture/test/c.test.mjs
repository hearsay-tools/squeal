import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
test("spawns", () => { const out = execFileSync(process.execPath, ["src/child.mjs"], { encoding: "utf8" }); assert.equal(out.trim(), "ok"); });
