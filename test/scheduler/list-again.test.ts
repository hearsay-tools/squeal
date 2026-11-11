import { describe, expect, it } from "vitest";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Row 015-52 (request e86a66d4): a runner part that throws before its test
 * file listing is applied leaves `listingFailed` set, so the next revision
 * lists again (`refinement.ts`), even for an edit that adds no test file.
 *
 * Fixture `barrel`: `test/barrel.test.ts` imports `src/index.ts`, which
 * re-exports `src/math.ts` and `src/strings.ts`.
 */

const ADDED = 'import { it } from "vitest";\n\nit("is added", () => {});\n';

/** A barrel harness, started; the runner part's error is expected. */
async function started(): Promise<Harness> {
  const repo = createRepo("barrel");
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1, allowErrors: true });
  await h.scheduler.start();
  await h.scheduler.idle();
  return h;
}

describe("scheduler: a listing a runner part did not apply (row 015-52)", SLOW, () => {
  it("lists again after a runner part that threw before its listing was applied", async () => {
    const h = await started();
    let lists = 0;
    const testFiles = h.runner.testFiles;
    h.runner.testFiles = () => {
      lists++;
      return testFiles();
    };
    // The project reads as recreated, and its environment names a path outside the worktree:
    // keying it throws in `setEnvironments`, before `applyListing` (request e86a66d4).
    let broken = true;
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) => {
      const result = await invalidate(paths);
      return broken ? { ...result, recreatedProjects: [""] } : result;
    };
    const environment = h.runner.environment;
    h.runner.environment = async () => {
      const read = await environment();
      return broken
        ? read.map((e) => ({ ...e, files: [...e.files, "/outside/the/worktree.ts"] }))
        : read;
    };
    h.write("test/added.test.ts", ADDED);
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();
    expect(h.errors.map((e) => e.message)).toEqual([
      expect.stringContaining("Invalid path '/outside'"),
    ]);

    broken = false;
    const before = lists;
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await h.scheduler.idle();
    expect(lists).toBe(before + 1);
    expect(h.keyOf("test/added.test.ts")).not.toBeNull();
  });
});
