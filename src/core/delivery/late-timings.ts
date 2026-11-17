import { readEditTimings } from "../scheduler/edit-timings.js";
import { durationOf } from "../scheduler/files.js";
import { FEED_LATE_MS } from "../status/feed-late.js";
import type { WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { DEFAULT_POLICY } from "../types/policy.js";
import type { Store } from "../types/store.js";
import { type BoundFile, type LateBoundInput, lateBoundMs, median } from "./late-bound.js";

/*
 * Row 005-93, part 1 (design section 1): what the late bound reads from the store. The tier
 * size, widths and parts, the first start of each edit revision and each edit tier's estimate
 * are the scheduler's own record (`readEditTimings`, review 0.1.530 B2 and B3); each tier's end
 * is its run row. `start` and `overhead` are their medians, 0 before any edit tier and never
 * below 0, so the bound is never below the files' own durations.
 */

/** This worktree's start delay and overhead medians, from the scheduler's record and its runs. */
export function worktreeMedians(
  store: Store,
  worktreeId: WorktreeId,
): Pick<LateBoundInput, "startMs" | "overheadMs"> {
  const timings = readEditTimings(store, worktreeId);
  if (timings === null) return { startMs: 0, overheadMs: 0 };
  const overheads = timings.tiers.flatMap(({ runId, estimateMs }) => {
    const run = store.runs.get(runId);
    return run?.end === "completed" && run.endedAt !== null
      ? [run.endedAt - run.startedAt - estimateMs]
      : [];
  });
  return {
    startMs: Math.max(0, median(timings.firsts.map((f) => f.delayMs))),
    overheadMs: Math.max(0, median(overheads)),
  };
}

/**
 * Whether `ageMs` passed the late bound of `files`. Each file runs at the width the scheduler
 * recorded for its project at its tier size; a project it recorded none for runs one at a time,
 * so no bound is shorter than the files' real wait. The durations alone are a lower bound, so an
 * age within twice them reads no run record. With nothing measured, no duration stored for any
 * file and no edit tier recorded, the bound would be 0 and every edit late at once: the change
 * feed's own late time (`FEED_LATE_MS`) stands in for it.
 */
export function pastBound(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[],
  ageMs: number,
): boolean {
  const timings = readEditTimings(store, worktreeId);
  const tierSize = timings?.tierSize ?? DEFAULT_POLICY.runner.tierSize;
  const bound: BoundFile[] = files.map((file) => {
    const known = timings?.widths[file.project];
    return {
      ms: durationOf(store.results.newestForTestFile(file)),
      width: known?.width ?? 1,
      part: known?.part ?? "",
    };
  });
  const floor = lateBoundMs({ files: bound, tierSize, startMs: 0, overheadMs: 0 });
  if (ageMs <= floor) return false;
  const medians = worktreeMedians(store, worktreeId);
  const measured = lateBoundMs({ files: bound, tierSize, ...medians });
  return ageMs > (measured === 0 ? FEED_LATE_MS : measured);
}
