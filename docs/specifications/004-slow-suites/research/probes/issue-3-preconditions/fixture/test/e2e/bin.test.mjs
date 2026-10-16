// Checks the package's declared bin is on disk, as a packaging test would.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("every declared bin exists", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const path of Object.values(pkg.bin)) assert.ok(existsSync(path), `${path} is missing`);
});
