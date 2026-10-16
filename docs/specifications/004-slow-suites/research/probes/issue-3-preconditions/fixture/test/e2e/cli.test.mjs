// Spawns the built CLI: without dist/ node exits 1 and stdout is empty, so the
// failures read as an exit code and a regex mismatch, not a missing build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const run = (...args) => spawnSync(process.execPath, ["dist/cli.mjs", ...args], { encoding: "utf8" });

test("the CLI greets the named user", () => {
  assert.match(run("ada").stdout, /^hello, ada\n$/);
});

test("the CLI exits 0", () => {
  assert.equal(run().status, 0);
});
