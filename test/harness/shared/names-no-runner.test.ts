import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Spec 016 goal 7 and D5: no source file under `src/harness/shared` names a
 * runner. What the deny, the primer and the coverage lines know of a runner
 * is that runner's description, read through one registry.
 */

const SRC = join(import.meta.dirname, "../../../src");
const SHARED = join(SRC, "harness/shared");
const RUNNER = /vitest|\bvite\b|node\W*test|pytest|python|\.py\b/i;
/** An import of a runner's folder; the registry is the one runner module the harness may import. */
const RUNNER_IMPORT = /from\s+["'][^"']*\/runners\/(?!descriptions\.js["'])/;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const text = (path: string) => readFileSync(path, "utf8");

describe("what names a runner (spec 016 D5)", () => {
  it("is never a source file under src/harness/shared", () => {
    for (const path of sources(SHARED)) {
      const name = relative(SRC, path);
      expect(text(path), name).not.toMatch(RUNNER);
      expect(text(path), name).not.toMatch(RUNNER_IMPORT);
    }
  });

  it("is each runner's description, so the rule above can fail", () => {
    for (const runner of ["vitest", "node-test", "pytest"]) {
      expect(text(join(SRC, "runners", runner, "describe.ts")), runner).toMatch(RUNNER);
    }
  });
});
