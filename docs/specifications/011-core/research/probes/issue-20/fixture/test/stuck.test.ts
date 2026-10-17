// A real defect with the same error and the same kind of path: cleanup uses a
// non-recursive removal on a directory the test filled. ENOTEMPTY every run.
import { mkdtempSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "i20-stuck-"));
  writeFileSync(join(dir, "left-behind"), "x");
});

afterAll(() => {
  rmdirSync(dir);
});

it("passes its only test", () => {
  expect(dir.startsWith(tmpdir())).toBe(true);
});
