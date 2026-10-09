import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The package's built CLI, spawned as cezarion's package tests spawn theirs.
const CLI = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

test("shouts through the built CLI", () => {
  assert.equal(execFileSync(process.execPath, [CLI, "hi"], { encoding: "utf8" }), "HI!\n");
});
