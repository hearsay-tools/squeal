import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The package's CLI, run as its users run it: in a process of its own.
const cli = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

test("the CLI greets", () => {
  assert.equal(execFileSync(process.execPath, [cli], { encoding: "utf8" }), "hello\n");
});
