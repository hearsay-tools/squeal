import { describe, expect, it } from "vitest";
import type { Policy, RunReport, TestFileRef } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Row 011-66 (gh-50 symptom 2; spec 011 C4, C9, D12's no-loop rule): a tier
 * that crashes after its daemon's stop began is an interrupted run, not an
 * environment failure. Its files stay queued for the successor, which the
 * handover runs (011-33). A second such crash of a file at the same key
 * marks it `unknown`, so a run that stops its own daemon cannot loop. A
 * crash outside the stopping phase is unchanged. The crash is Vitest's when
 * a signal kills its fork workers with the daemon (`research/issue-50.md`).
 * Six test files, file i importing source i % 3; tiers of 2.
 */
const THREE = sources(3);
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };
const POOL_ERROR =
  "unhandled error outside any test file: Error: [vitest-pool]: Worker forks emitted error.";

/** The paths importing `source`. */
const importers = (files: readonly CatchUpFile[], source: string) =>
  files.filter((f) => f.imports[0] === source).map((f) => f.path);

/** Each run of `side` crashes, as Vitest's does when its workers die, while `crashing.on`. */
function crashes(side: CatchUpSide): { on: boolean } {
  const crashing = { on: false };
  const run = side.runner.run.bind(side.runner);
  side.runner.run = async (files: readonly TestFileRef[], options) => {
    const report = await run(files, options);
    if (!crashing.on) return report;
    const crashed: RunReport = {
      end: "crashed",
      durationMs: report.durationMs,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: POOL_ERROR,
    };
    return crashed;
  };
  return crashing;
}

/** A side of the worktree under `policy`: tiers of 2, the predecessor's store. */
function sideOf(repo: CatchUpRepo, files: readonly CatchUpFile[], policy: Partial<Policy>) {
  return catchUpSide(repo, repo.main, { files, hostSlots: 4, tierSize: 2, policy });
}

/** `path`'s row: its pending phase, and whether its checks read `unknown`. */
function rowOf(side: CatchUpSide, path: string) {
  const row = side.store.testFileKeys.list(side.worktreeId).find((r) => r.testFile.path === path);
  const states = side.store.knownStates.list(side.worktreeId);
  const unknown = states.some((s) => s.check.testPath === path && s.outcome === "unknown");
  return { pending: row?.pending ?? null, unknown };
}

/** Every file ran once; then a side under lookup-only with `edited`'s tier held in flight. */
async function heldTier(files: readonly CatchUpFile[], edited: string) {
  const repo = catchUpRepo(files);
  const first = sideOf(repo, files, {});
  await first.scheduler.start();
  await first.scheduler.idle();
  await first.scheduler.close();
  const side = sideOf(repo, files, LOOKUP_ONLY);
  const crashing = crashes(side);
  await side.scheduler.start();
  await side.scheduler.idle();
  side.runner.hold();
  await side.edit("watch", edited);
  await expect.poll(() => side.runner.active).toBe(1);
  return { repo, side, crashing };
}

/** A daemon's stop without a cancel (a signal, `sessions-gone`): the tier in flight crashes. */
async function crashWhileStopping(side: CatchUpSide, crashing: { on: boolean }): Promise<void> {
  crashing.on = true;
  const closing = side.scheduler.close();
  side.runner.release();
  await closing;
}

describe("scheduler: a tier that crashes while its daemon stops (row 011-66)", {
  timeout: 60_000,
}, () => {
  it("leaves its files queued, stores no UNKNOWN, and the successor runs them", async () => {
    const files = testFiles(6, THREE, () => 50);
    const source = THREE[0] ?? "";
    const { repo, side, crashing } = await heldTier(files, source);
    await crashWhileStopping(side, crashing);
    const crashed = importers(files, source);
    for (const path of crashed)
      expect(rowOf(side, path)).toEqual({ pending: "queued", unknown: false });

    const next = sideOf(repo, files, LOOKUP_ONLY);
    await next.scheduler.start();
    await next.scheduler.idle();
    expect(next.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual(crashed);
    for (const path of crashed) expect(next.current(path)).toBe(true);
  });

  it("a second such crash at the same key marks the file UNKNOWN, and no successor runs it", async () => {
    const files = testFiles(6, THREE, () => 50);
    const source = THREE[0] ?? "";
    const { repo, side, crashing } = await heldTier(files, source);
    await crashWhileStopping(side, crashing);
    const crashed = importers(files, source);

    const next = sideOf(repo, files, LOOKUP_ONLY);
    const again = crashes(next);
    next.runner.hold();
    await next.scheduler.start();
    await expect.poll(() => next.runner.active).toBe(1);
    await crashWhileStopping(next, again);
    for (const path of crashed) expect(rowOf(next, path)).toEqual({ pending: null, unknown: true });

    const third = sideOf(repo, files, LOOKUP_ONLY);
    await third.scheduler.start();
    await third.scheduler.idle();
    expect(third.runner.runs).toEqual([]);
  });

  it("a crash outside the stopping phase is unchanged: UNKNOWN, unqueued", async () => {
    const files = testFiles(6, THREE, () => 50);
    const source = THREE[0] ?? "";
    const { side, crashing } = await heldTier(files, source);
    crashing.on = true;
    side.runner.release();
    await side.scheduler.idle();
    for (const path of importers(files, source)) {
      expect(rowOf(side, path)).toEqual({ pending: null, unknown: true });
    }
  });
});
