import { testFileId } from "../keys/index.js";
import type {
  EpochMs,
  RetryWait,
  RunRecord,
  SlowTierActivity,
  TestFileRef,
} from "../types/index.js";

/*
 * Row 011-272 (gh-114; 011 C5 and C6, 004 D2 and D8): what holds a retry's
 * run that is queued and has not started, as `squeal retry` and status say
 * it, from what the live daemon recorded: its open runs and its slow tier's
 * published activity. No scheduler state is added; what they do not name is
 * `unknown`.
 */

/** What the live daemon recorded that a queued run waits on. */
export interface QueueReads {
  readonly isSlow: (ref: TestFileRef) => boolean;
  /** The slow tier's activity as true now (`SlowTierState.activity`); `null` with none. */
  readonly activity: SlowTierActivity | null;
  /** The live daemon's open runs; none without a live daemon. */
  readonly runs: readonly RunRecord[];
}

const UNKNOWN: RetryWait = { kind: "unknown" };

/**
 * What holds `ref`'s queued run. A fast file waits on a tier of its lane,
 * read as an open run of its project's fast files (one runner, one lane).
 * A slow file waits as its slow tier published (004 D8), or, with nothing
 * published, on an open fast run: an edit's fast tier keeps the slow tier
 * from looking, so it publishes no wait (`research/issue-114.md` F1).
 */
export function retryWaitOf(ref: TestFileRef, { isSlow, activity, runs }: QueueReads): RetryWait {
  const id = testFileId(ref);
  const own = runs.find((run) => run.testFiles.some((f) => testFileId(f) === id));
  if (own !== undefined) return { kind: "running", since: own.startedAt };
  if (!isSlow(ref)) {
    const since = earliest(runs, (f) => f.project === ref.project && !isSlow(f));
    return since === null ? UNKNOWN : { kind: "tier", since };
  }
  const fast = earliest(runs, (f) => !isSlow(f));
  if (activity?.kind === "running") return { kind: "slow", since: activity.since };
  if (activity?.kind === "waiting") {
    return activity.for === "fast" ? { kind: "fast", since: fast } : { kind: activity.for };
  }
  return fast === null ? UNKNOWN : { kind: "fast", since: fast };
}

/** The earliest start of an open run holding a file `holds` takes; `null` with none. */
function earliest(runs: readonly RunRecord[], holds: (f: TestFileRef) => boolean): EpochMs | null {
  const starts = runs.filter((run) => run.testFiles.some(holds)).map((run) => run.startedAt);
  return starts.length === 0 ? null : (Math.min(...starts) as EpochMs);
}
