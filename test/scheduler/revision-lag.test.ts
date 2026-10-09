import { describe, expect, it } from "vitest";
import { isPending } from "../../src/core/state/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons, defect 1: a revision lagged the workspace by a whole tier, because
 * the batch held the scheduler across `runner.invalidate`, which waits behind
 * the running tier. Spec 001 D2 as amended: "Creating a revision never waits
 * on the runner: the store work [...] completes within the debounce window
 * even while a tier is running, and the runner-dependent refinement is queued
 * behind the tier separately."
 *
 * Fixture `barrel`: `test/barrel.test.ts` imports `src/index.ts`, which
 * re-exports `src/math.ts` and `src/strings.ts`, and takes 5 s.
 */
describe("scheduler: revisions during a running tier (D2, D5)", SLOW, () => {
  it("records each revision within 500 ms while a 5 s tier runs, with the changed files pending", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    let tierStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      tierStarted = resolve;
    });
    h.runner.beforeRun = (files) => {
      if (files.some((f) => f.path === "test/barrel.test.ts")) tierStarted();
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await started;
    const runsBefore = h.runner.runs.length;
    const first = store.revisions.latest(h.worktreeId)?.number ?? 0;
    // When the runner part of each revision calls the runner: runs recorded by then, and paths.
    const invalidations: { runs: number; paths: string[] }[] = [];
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = (paths) => {
      invalidations.push({ runs: h.runner.runs.length, paths: paths.map((p) => p.path) });
      return invalidate(paths);
    };

    // Two edits while the barrel tier is in flight, as in the lag probe.
    for (const [i, body] of ["a + b + 0", "a + b + 1 - 1"].entries()) {
      h.write("src/math.ts", `export const add = (a: number, b: number) => ${body};\n`);
      const before = performance.now();
      await h.batch("src/math.ts");
      expect(performance.now() - before).toBeLessThan(500);
      expect(store.revisions.latest(h.worktreeId)?.number).toBe(first + i + 1);
    }
    // Still inside the 5 s tier: nothing else ran yet.
    expect(h.runner.runs).toHaveLength(runsBefore);

    // What `squeal status` reads: the edited module's test file is queued at the new revision.
    const rows = store.testFileKeys.list(h.worktreeId);
    const math = rows.find((row) => row.testFile.path === "test/math.test.ts");
    expect(math).toMatchObject({ revision: first + 2, pending: "queued" });
    expect(math?.key).toBe(h.keyOf("test/math.test.ts"));
    // Both test files, each with its file-level check and one test: all pending, none current.
    expect(h.header()).toMatchObject({
      revision: first + 2,
      counts: { current: 0, pending: 4, stale: 0, unknown: 0 },
    });

    await h.scheduler.idle();
    // The runner part of each revision, once and in batch order. Task 001-140: the first is
    // called beside the tier in flight and waits in the adapter, which serializes behind its run.
    expect(invalidations).toEqual([
      { runs: runsBefore, paths: ["src/math.ts"] },
      { runs: runsBefore + 1, paths: ["src/math.ts"] },
    ]);
    expect(h.header()).toMatchObject({
      revision: first + 2,
      counts: { current: 4, pending: 0, stale: 0, unknown: 0 },
    });
  });

  /*
   * Review wave 4.5, S1 and probe G: a failing test file written during a
   * tier was in no count until the tier ended, and for a moment after it the
   * store read "nothing pending" at its revision.
   */
  it("never reads nothing pending at the revision of a test file added during a tier", async () => {
    const repo = createRepo("barrel");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();

    let tierStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      tierStarted = resolve;
    });
    h.runner.beforeRun = (files) => {
      if (files.some((f) => f.path === "test/barrel.test.ts")) tierStarted();
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await started;

    h.write(
      "test/zz/new.test.ts",
      'import { expect, it } from "vitest";\n\nit("is new", () => {\n  expect(1).toBe(2);\n});\n',
    );
    await h.batch("test/zz/new.test.ts");
    const added = store.revisions.latest(h.worktreeId)?.number ?? 0;
    expect(h.header()).toMatchObject({ revision: added, runnerPartPending: true });

    // What a status read or a Stop wait sees until everything settled.
    const quietWithoutTheFile: number[] = [];
    let reads = 0;
    const sample = () => {
      const header = h.header();
      reads++;
      const listed = store.testFileKeys
        .list(h.worktreeId)
        .some((row) => row.testFile.path === "test/zz/new.test.ts");
      if (header.revision >= added && !isPending(header) && !listed) {
        quietWithoutTheFile.push(header.revision);
      }
    };
    const poll = setInterval(sample, 2);
    try {
      await h.scheduler.idle();
    } finally {
      clearInterval(poll);
    }
    sample();

    expect(reads).toBeGreaterThan(100);
    expect(quietWithoutTheFile).toEqual([]);
    expect(h.header()).toMatchObject({ refinedRevision: added, runnerPartPending: false });
    // Its run and the re-run of its new fail (task 001-171).
    expect(h.runsOf("test/zz/new.test.ts")).toHaveLength(2);
    const failing = store.knownStates
      .list(h.worktreeId)
      .filter((s) => s.check.testPath === "test/zz/new.test.ts" && s.outcome === "fail");
    expect(failing).toHaveLength(1);
  });
});
