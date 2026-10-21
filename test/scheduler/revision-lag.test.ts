import { describe, expect, it } from "vitest";
import { isPending } from "../../src/core/state/index.js";
import { cancelled as cancelText } from "../../src/runners/vitest/run.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

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
const BARREL = "test/barrel.test.ts";
const holdsBarrel = (files: readonly { path: string }[]) => files.some((f) => f.path === BARREL);

/**
 * A harness whose barrel test runs in a tier of its own, an edit's: the
 * barrel's own import has no namesake, so its direct importer is the edit's
 * work (011 C4 step 4 as amended for 011-25). Resolves once that tier is in
 * flight; `barrier`, when given, holds its run there until it resolves.
 */
async function barrelInFlight(barrier?: Promise<void>) {
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
    if (!holdsBarrel(files)) return;
    tierStarted();
    return barrier;
  };
  h.write(
    "src/index.ts",
    'export { add } from "./math.ts";\nexport { upper } from "./strings.ts";\n// 1\n',
  );
  await h.batch("src/index.ts");
  await started;
  const runsBefore = h.runner.runs.length;
  const first = store.revisions.latest(h.worktreeId)?.number ?? 0;
  return { h, store, runsBefore, first };
}

/** Saves `src/math.ts` with `body`; how long the revision took to record, in ms. */
async function saveMath(h: Harness, body: string): Promise<number> {
  h.write("src/math.ts", `export const add = (a: number, b: number) => ${body};\n`);
  const before = performance.now();
  await h.batch("src/math.ts");
  return performance.now() - before;
}

describe("scheduler: revisions during a running tier (D2, D5)", SLOW, () => {
  /*
   * An edit of `src/math.ts` changes an input of all of the barrel's tier,
   * so it cancels the tier (011 C4 step 5 as amended 2026-10-21, row
   * 011-51); before it, the tier ran its 5 s to the end. Held at an
   * explicit barrier, the run is still in flight through both edits, as the
   * lag probe's was, whenever the cancel lands; opened, it ends at once.
   */
  it("records each revision within 500 ms while a tier is in flight, with the changed files pending", async () => {
    let open: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { h, store, runsBefore, first } = await barrelInFlight(barrier);
    // When the runner part of each revision calls the runner: runs recorded by then, and paths.
    const invalidations: { runs: number; paths: string[] }[] = [];
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = (paths) => {
      invalidations.push({ runs: h.runner.runs.length, paths: paths.map((p) => p.path) });
      return invalidate(paths);
    };

    try {
      // Two edits while the barrel tier is in flight, as in the lag probe.
      for (const [i, body] of ["a + b + 0", "a + b + 1 - 1"].entries()) {
        expect(await saveMath(h, body)).toBeLessThan(500);
        expect(store.revisions.latest(h.worktreeId)?.number).toBe(first + i + 1);
      }
      // Still held at the barrier: nothing else ran yet.
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
      // Task 001-140: the first runner part is called beside the run in flight, and waits there.
      await expect.poll(() => invalidations.length, { timeout: 30_000 }).toBe(1);
    } finally {
      open();
    }

    await h.scheduler.idle();
    // The runner part of each revision, once and in batch order: the first waited in the
    // adapter, which serializes behind the run; the second came once the run ended.
    expect(invalidations).toEqual([
      { runs: runsBefore, paths: ["src/math.ts"] },
      { runs: runsBefore + 1, paths: ["src/math.ts"] },
    ]);
    expect(h.header()).toMatchObject({
      revision: first + 2,
      counts: { current: 4, pending: 0, stale: 0, unknown: 0 },
    });
  });

  it("cancels the tier in flight early once a revision re-keys all of it, recording the revision within 500 ms", async () => {
    const { h, store, runsBefore, first } = await barrelInFlight();

    expect(await saveMath(h, "a + b + 0")).toBeLessThan(500);
    expect(store.revisions.latest(h.worktreeId)?.number).toBe(first + 1);
    await h.scheduler.idle();

    // The 5 s run ended at the cancel, its file not completed (011 C4 step 5 as amended 2026-10-21).
    const [cancelled, ...after] = h.runner.runs.slice(runsBefore);
    expect(cancelled?.files.map((f) => f.path)).toEqual([BARREL]);
    expect(cancelled?.report.failure).toContain(cancelText("supersession"));
    expect(cancelled?.report.completedFiles).toEqual([]);
    // Then each test file once, to its end, at the new key.
    const ran = after.flatMap((run) => run.report.completedFiles.map((f) => f.path));
    expect(ran.sort()).toEqual([BARREL, "test/math.test.ts"]);
    expect(after.map((run) => run.report.failure)).toEqual([null, null]);
    expect(h.header()).toMatchObject({
      revision: first + 1,
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
