// Child variant: the packaged test starts scripts/release.mjs as a separate process, as a release e2e test does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";

test("release publishes public packages", () => {
  assert.ok(existsSync("dist/stamp.json"), "run the build first");
  const out = JSON.parse(execFileSync(process.execPath, ["scripts/release.mjs", "a", "@private/b", "--dry-run"], { encoding: "utf8" }));
  for (const line of out) {
    assert.match(line, /^would publish/);
  }
});
