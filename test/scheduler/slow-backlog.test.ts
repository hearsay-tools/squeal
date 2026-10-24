import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY, type RunOptions, type TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 004 D2 as amended 2026-10-14 (task 004-60, from a cezar warm-up whose
 * browser files ran beside its whole unit-suite baseline): the slow tier
 * waits while its own daemon's fast backlog (a baseline, a checkpoint, `run
 * --all`) is queued or running; an explicit `run --slow` still runs at once.
 * One file per backlog tier, so the baseline's fast files stay queued behind
 * the held first one. In the `basic` fixture these two files are slow.
 */

const SLOW_FILES = ["test/strings.test.ts", "test/upper.test.ts"];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-60-"));
  dirs.push(dir);
  return dir;
}

async function open(extra: Partial<HarnessOptions> = {}): Promise<Harness> {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  return openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    backlogTierSize: 1,
    policy: { ...RUN_MISSING, slow: { ...DEFAULT_POLICY.slow, include: SLOW_FILES } },
    slow: { slotDir: tempDir(), recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
    ...extra,
  });
}

/** Holds the first fast run until `release`; `held` is true while it waits. */
function holdFirstFast(h: Harness) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: false, release: () => release() };
  onTestFinished(() => release());
  let taken = false;
  h.runner.beforeRun = async (files: readonly TestFileRef[]) => {
    if (taken || files.some((f) => SLOW_FILES.includes(f.path))) return;
    taken = true;
    state.held = true;
    await gate;
    state.held = false;
  };
  return state;
}

const isSlow = (files: readonly TestFileRef[]) => files.some((f) => SLOW_FILES.includes(f.path));
const slowRuns = (h: Harness) => h.runner.runs.filter((run) => isSlow(run.files));

describe(
  "the slow tier waits for its daemon's fast backlog (spec 004 D2, task 004-60)",
  SLOW,
  () => {
    it("runs every fast backlog tier of a baseline with slow files first", async () => {
      const h = await open();
      const backlog = holdFirstFast(h);
      await h.scheduler.start();
      await waitFor(() => backlog.held, 60_000);
      // The idle trigger holds (no consumer) and the load is 0: only the backlog holds the slow tier.
      await delay(500);
      expect(slowRuns(h)).toEqual([]);
      expect(readSlowActivity(h.store, h.worktreeId)).toEqual({ kind: "waiting", for: "fast" });
      backlog.release();
      await waitFor(() => slowRuns(h).flatMap((r) => r.files).length === 2, 60_000);
      await h.scheduler.idle();
      const runs = h.runner.runs.map((run) => isSlow(run.files));
      const firstSlow = runs.indexOf(true);
      expect(firstSlow).toBeGreaterThan(0);
      expect(runs.slice(firstSlow)).not.toContain(false);
      // Nothing fast was left: the idle tier took both files at once (D2's idle width).
      expect(slowRuns(h).map((run) => run.files.length)).toEqual([2]);
    });

    it("runs a run --slow request at once beside the held baseline, ungranted when the pool has no room", async () => {
      // One slot: the held backlog tier has the daemon's free worker and there is no permit.
      const h = await open({ capacity: { dir: join(tempDir(), "pool"), hostSlots: 1 } });
      const backlog = holdFirstFast(h);
      await h.scheduler.start();
      await waitFor(() => backlog.held, 60_000);
      expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 2 });
      await waitFor(() => slowRuns(h).length === 2, 60_000);
      expect(backlog.held).toBe(true);
      // Fast work is queued and running: one file per tier, run as an edit's tier is, without a grant.
      const ran = slowRuns(h).map((run) => [
        run.files.length,
        (run.options as RunOptions).workers ?? null,
      ]);
      expect(ran).toEqual([
        [1, null],
        [1, null],
      ]);
      backlog.release();
      await h.scheduler.idle();
    });
  },
);

/** The fast test files whose rows the store leaves `queued`. */
const queuedRows = (h: Harness) =>
  h.store.testFileKeys
    .list(h.worktreeId)
    .filter((row) => row.pending === "queued" && !SLOW_FILES.includes(row.testFile.path))
    .map((row) => row.testFile.path);

describe("a departure drain runs its session's work (011 C9, 004 D2, row 011-93)", SLOW, () => {
  it("runs the slow files before the paused backlog, whose files stay queued", async () => {
    const h = await open();
    const backlog = holdFirstFast(h);
    await h.scheduler.start();
    await waitFor(() => backlog.held, 60_000);
    h.scheduler.pauseBacklog(true);
    backlog.release();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    await h.scheduler.idle();
    // The held tier stored; no other fast tier ran, and its two files stay queued for the next daemon.
    expect(h.runner.runs.filter((run) => !isSlow(run.files))).toHaveLength(1);
    expect(
      slowRuns(h)
        .flatMap((run) => run.files.map((f) => f.path))
        .sort(),
    ).toEqual(SLOW_FILES);
    expect(h.scheduler.queued()).toBe(2);
    expect(queuedRows(h)).toHaveLength(2);
    expect(h.scheduler.owedWork()).toBeNull();
  });

  it("runs an open run --all's fast files in the drain", async () => {
    const h = await open();
    const backlog = holdFirstFast(h);
    await h.scheduler.start();
    await waitFor(() => backlog.held, 60_000);
    await h.scheduler.requestFullSuite();
    h.scheduler.pauseBacklog(true);
    backlog.release();
    await waitFor(() => h.scheduler.owedWork() === null && !h.scheduler.slowPending(), 60_000);
    await h.scheduler.idle();
    expect(h.scheduler.queued()).toBe(0);
    expect(queuedRows(h)).toEqual([]);
  });

  it("ends the pause when a session registers: the backlog runs again", async () => {
    const h = await open();
    const backlog = holdFirstFast(h);
    await h.scheduler.start();
    await waitFor(() => backlog.held, 60_000);
    h.scheduler.pauseBacklog(true);
    backlog.release();
    await waitFor(() => !h.scheduler.slowPending(), 60_000);
    await h.scheduler.idle();
    expect(h.scheduler.queued()).toBe(2);
    h.scheduler.pauseBacklog(false);
    await waitFor(() => h.scheduler.queued() === 0, 60_000);
    await h.scheduler.idle();
    expect(h.runner.runs.filter((run) => !isSlow(run.files))).toHaveLength(3);
  });
});
