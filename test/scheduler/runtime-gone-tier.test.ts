import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Policy, RunReport, TestFileRef } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Review 0.1.262, B2 (row 011-106; spec 011 C9, C11): a tier during which the
 * daemon's own runtime went stores nothing, and that holds for a run that
 * failed to start as for one whose files ran. Vitest reports a run that
 * rejects before any file is queued as a startup failure, and a recorder the
 * removal took is one: its setup check neither fails nor passes, and no file
 * of the project leaves the queue. Two test files of one project, tiers of
 * one, so the second is still queued when the first's tier ends.
 */
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };

/** A directory standing for the daemon's own runtime, there until a test removes it. */
function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-runtime-gone-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A side of the repository's main worktree, tiers of one, its runtime at `runtime`. */
function sideOf(
  repo: CatchUpRepo,
  files: readonly CatchUpFile[],
  runtime: string,
  told: string[],
  more: Partial<CatchUpOptions> = {},
): CatchUpSide {
  return catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    tierSize: 1,
    backlogTierSize: 1,
    ...more,
    scheduler: { runtimeDir: runtime, onReinstall: (note) => told.push(note), ...more.scheduler },
  });
}

/**
 * Each run of `side` fails to start, as Vitest's does without its recorder,
 * and removes `runtime` first unless it is `null`. Returns each run's paths.
 */
function failsToStart(side: CatchUpSide, runtime: string | null): string[][] {
  const runs: string[][] = [];
  side.runner.run = async (files: readonly TestFileRef[]) => {
    runs.push(files.map((f) => f.path));
    if (runtime !== null) rmSync(runtime, { recursive: true, force: true });
    const report: RunReport = {
      end: "crashed",
      durationMs: 1,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: "Error: Cannot find module recorder.cjs",
      startupFailure: {
        projects: [""],
        testFiles: files,
        setupFile: "setup.ts",
        error: {
          name: "Error",
          message: "Cannot find module recorder.cjs",
          stack: null,
          location: null,
          diff: null,
          phase: "setup",
        },
      },
    };
    return report;
  };
  return runs;
}

/** Each row's pending phase, and the worktree's known states that are not passing. */
function stored(side: CatchUpSide) {
  const rows = side.store.testFileKeys
    .list(side.worktreeId)
    .map((r) => ({ path: r.testFile.path, pending: r.pending }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const states = side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => s.outcome !== "pass")
    .map((s) => ({ kind: s.check.kind, path: s.check.testPath, outcome: s.outcome }));
  return { rows, states };
}

describe("scheduler: a tier during which its runtime went (review 0.1.262)", {
  timeout: 60_000,
}, () => {
  it("B2: a run that failed to start fails no setup, and both files stay queued for the successor", async () => {
    const files = testFiles(2, [], () => 50);
    const repo = catchUpRepo(files);
    const runtime = runtimeDir();
    const told: string[] = [];
    const side = sideOf(repo, files, runtime, told);
    failsToStart(side, runtime);
    await side.scheduler.start();
    await expect.poll(() => told.length).toBe(1);
    await side.scheduler.close();
    expect(told[0]).toContain("squeal start");
    const paths = files.map((f) => f.path);
    expect(stored(side)).toEqual({
      rows: paths.map((path) => ({ path, pending: "queued" })),
      states: [],
    });

    mkdirSync(runtime);
    const next = sideOf(repo, files, runtime, [], { policy: LOOKUP_ONLY });
    await next.scheduler.start();
    await next.scheduler.idle();
    expect(next.runner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual(paths);
    for (const path of paths) expect(next.current(path)).toBe(true);
    expect(stored(next).states).toEqual([]);
  });

  it("B2: with its runtime there, the same failure fails the setup and leaves the queue, as before", async () => {
    const files = testFiles(2, [], () => 50);
    const told: string[] = [];
    const side = sideOf(catchUpRepo(files), files, runtimeDir(), told);
    failsToStart(side, null);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(told).toEqual([]);
    expect(stored(side)).toEqual({
      rows: files.map((f) => ({ path: f.path, pending: null })),
      states: [{ kind: "setup", path: "setup.ts", outcome: "fail" }],
    });
  });

  it("B2: a run whose files completed while its runtime went passes no failing setup", async () => {
    const files = testFiles(2, [], () => 50);
    const repo = catchUpRepo(files);
    const runtime = runtimeDir();
    const failing = sideOf(repo, files, runtime, []);
    failsToStart(failing, null);
    await failing.scheduler.start();
    await failing.scheduler.idle();
    await failing.scheduler.close();

    const told: string[] = [];
    const side = sideOf(repo, files, runtime, told, { tierSize: 2, backlogTierSize: 2 });
    const run = side.runner.run.bind(side.runner);
    side.runner.run = async (files, options) => {
      const report = await run(files, options);
      rmSync(runtime, { recursive: true, force: true });
      return report;
    };
    await side.scheduler.start();
    await expect.poll(() => told.length).toBe(1);
    await side.scheduler.close();
    expect(side.runner.runs.map((r) => r.completed.length)).toEqual([2]);
    expect(stored(side)).toEqual({
      rows: files.map((f) => ({ path: f.path, pending: "queued" })),
      states: [{ kind: "setup", path: "setup.ts", outcome: "fail" }],
    });
  });

  it("B2: a second such run at the same key records as usual, its setup failure too", async () => {
    const files = testFiles(1, [], () => 50);
    const repo = catchUpRepo(files);
    const runtime = runtimeDir();
    // The first daemon runs its misses; the second only what the first left queued.
    for (const policy of [{}, LOOKUP_ONLY]) {
      mkdirSync(runtime, { recursive: true });
      const told: string[] = [];
      const side = sideOf(repo, files, runtime, told, { policy });
      failsToStart(side, runtime);
      await side.scheduler.start();
      await expect.poll(() => told.length).toBe(1);
      await side.scheduler.close();
    }
    const last = sideOf(repo, files, runtime, []);
    expect(stored(last)).toEqual({
      rows: [{ path: "test/f000.test.ts", pending: null }],
      states: [{ kind: "setup", path: "setup.ts", outcome: "fail" }],
    });
  });

  it("B2: in a tier beside a file at its first such run, one past it is unknown and fails no setup", async () => {
    const files = testFiles(2, sources(2), () => 50);
    const paths = files.map((f) => f.path);
    const repo = catchUpRepo(files);
    const runtime = runtimeDir();
    const passed = sideOf(repo, files, runtime, []);
    await passed.scheduler.start();
    await passed.scheduler.idle();
    await passed.scheduler.close();

    // An edit of s00 queues f000 alone; its run takes the runtime, and it is queued again.
    const toldFirst: string[] = [];
    const first = sideOf(repo, files, runtime, toldFirst, { policy: LOOKUP_ONLY });
    const ran = failsToStart(first, runtime);
    await first.scheduler.start();
    await first.scheduler.idle();
    await first.edit("watch", "src/s00.ts");
    await expect.poll(() => toldFirst.length).toBe(1);
    await first.scheduler.close();
    expect(ran).toEqual([["test/f000.test.ts"]]);

    // s01 moved too: f000 at its second such run beside f001 at its first, in one tier of two.
    first.touch("src/s01.ts");
    mkdirSync(runtime);
    const told: string[] = [];
    const second = sideOf(repo, files, runtime, told, { tierSize: 2, backlogTierSize: 2 });
    const again = failsToStart(second, runtime);
    await second.scheduler.start();
    await expect.poll(() => told.length).toBe(1);
    await second.scheduler.close();
    expect(again.map((run) => [...run].sort())).toEqual([paths]);
    expect(stored(second)).toEqual({
      rows: [
        { path: "test/f000.test.ts", pending: null },
        { path: "test/f001.test.ts", pending: "queued" },
      ],
      // As a crashed run's file: its check and its file's are `unknown`.
      states: [
        { kind: "file", path: "test/f000.test.ts", outcome: "unknown" },
        { kind: "test", path: "test/f000.test.ts", outcome: "unknown" },
      ],
    });
  });
});
