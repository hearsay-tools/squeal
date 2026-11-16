import { wallEstimate } from "../scheduler/backlog.js";
import { durationOf } from "../scheduler/files.js";
import { FEED_LATE_MS } from "../status/feed-late.js";
import type { WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { DEFAULT_POLICY } from "../types/policy.js";
import type { Store } from "../types/store.js";
import { type LateBoundInput, lateBoundMs, median } from "./late-bound.js";

/*
 * Row 005-93, part 1 (design section 1): what the late bound reads from the store. `start` and
 * `overhead` are this worktree's medians over its newest edit runs: an edit's revision to its
 * first run's start, and a run's wall time minus its wall estimate. Both are 0 before any run,
 * and never below 0, so the bound is never below the files' own durations.
 */

/** The newest completed edit runs the medians read. */
export const RUNS_MEASURED = 20;

/**
 * Files per tier. A hook reads no policy, so the default `runner.tierSize`; each tier runs one
 * worker per file, as an edit's tier of that size does.
 */
const TIER_SIZE = DEFAULT_POLICY.runner.tierSize;

/** This worktree's start delay and overhead medians, from its stored runs. */
export function worktreeMedians(
  store: Store,
  worktreeId: WorktreeId,
): Pick<LateBoundInput, "startMs" | "overheadMs"> {
  const timings = store.runs.recentTimings(worktreeId, RUNS_MEASURED);
  const firstStart = new Map<number, number>();
  const overheads: number[] = [];
  for (const run of timings) {
    const was = firstStart.get(run.revision);
    if (was === undefined || run.startedAt < was) firstStart.set(run.revision, run.startedAt);
    if (run.durations.length === 0) continue;
    const sum = run.durations.reduce((total, ms) => total + ms, 0);
    const estimate = wallEstimate(sum, Math.max(...run.durations), run.durations.length);
    overheads.push(run.endedAt - run.startedAt - estimate);
  }
  const starts = [...firstStart].flatMap(([revision, startedAt]) => {
    const createdAt = store.revisions.get(worktreeId, revision)?.createdAt;
    return createdAt === undefined ? [] : [startedAt - createdAt];
  });
  return { startMs: Math.max(0, median(starts)), overheadMs: Math.max(0, median(overheads)) };
}

/**
 * Whether `ageMs` passed the late bound of `files`. The durations alone are a lower bound, so
 * an age within twice them reads no run record (`worktreeMedians`). With nothing measured, no
 * duration stored for any file and no stored run, the bound would be 0 and every edit late at
 * once: the change feed's own late time (`FEED_LATE_MS`) stands in for it.
 */
export function pastBound(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[],
  ageMs: number,
): boolean {
  const durations = files.map((file) => durationOf(store.results.newestForTestFile(file)));
  const floor = lateBoundMs({ durations, tierSize: TIER_SIZE, startMs: 0, overheadMs: 0 });
  if (ageMs <= floor) return false;
  const medians = worktreeMedians(store, worktreeId);
  const bound = lateBoundMs({ durations, tierSize: TIER_SIZE, ...medians });
  return ageMs > (bound === 0 ? FEED_LATE_MS : bound);
}
