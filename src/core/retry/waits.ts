import { testFileId } from "../keys/reverse-index.js";
import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { RetryWait } from "../types/standing.js";
import type { GroupTierState, SlowTierActivity } from "../types/status.js";
import type { RunRecord } from "../types/store-records.js";

/*
 * Row 011-272 (gh-114; 011 C5 and C6, 004 D2 and D8): what holds a retry's
 * run that is queued and has not started, as `squeal retry` and status say
 * it, from what the live daemon recorded: its open runs and its slow tier's
 * published activity. No scheduler state is added; what they do not name is
 * `unknown`.
 */

/** A configured group's lane as a retry reads it (row 019-27): a `GroupTierState`'s. */
export type GroupLane = Pick<GroupTierState, "name" | "at" | "after" | "activity">;

/** What the live daemon recorded that a queued run waits on. */
export interface QueueReads {
  readonly isSlow: (ref: TestFileRef) => boolean;
  /** The slow tier's activity as true now (`SlowTierState.activity`); `null` with none. */
  readonly activity: SlowTierActivity | null;
  /** The live daemon's open runs; none without a live daemon. */
  readonly runs: readonly RunRecord[];
  /**
   * Row 019-27 (spec 019 D3): the configured group that owns a file, with
   * its lane's activity as true now; `null` for a default group's file.
   * Absent without a live daemon or a `checks` key.
   */
  readonly groupOf?: (ref: TestFileRef) => GroupLane | null;
}

const UNKNOWN: RetryWait = { kind: "unknown" };

/**
 * What holds `ref`'s queued run. A fast file waits on a tier of its lane,
 * read as an open run of its project's fast files (one runner, one lane).
 * A slow file waits as its slow tier published (004 D8), or, with nothing
 * published, on an open fast run: an edit's fast tier keeps the slow tier
 * from looking, so it publishes no wait (`research/issue-114.md` F1). A
 * configured group's file waits as its group's lane published (row
 * 019-27), and no group lane's run is fast work.
 */
export function retryWaitOf(ref: TestFileRef, reads: QueueReads): RetryWait {
  const { isSlow, activity, runs, groupOf } = reads;
  const id = testFileId(ref);
  const own = runs.find((run) => run.testFiles.some((f) => testFileId(f) === id));
  if (own !== undefined) return { kind: "running", since: own.startedAt };
  const group = groupOf?.(ref) ?? null;
  if (group !== null) return groupWaitOf(group);
  const fastFile = (f: TestFileRef) => !isSlow(f) && (groupOf?.(f) ?? null) === null;
  if (!isSlow(ref)) {
    const since = earliest(runs, (f) => f.project === ref.project && fastFile(f));
    return since === null ? UNKNOWN : { kind: "tier", since };
  }
  const fast = earliest(runs, fastFile);
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

/** A configured group's file, by its group and what its lane published (row 019-27). */
function groupWaitOf({ name, at, after, activity }: GroupLane): RetryWait {
  const lane =
    activity === null
      ? null
      : activity.kind === "running"
        ? { kind: "running" as const, since: activity.since }
        : activity;
  return { kind: "group", group: name, at, after, lane };
}

/**
 * Row 019-27: `groupOf` from the configured groups' lane states and the
 * name of the group that owns a file (`groupView(policy).of`): only a
 * group with a lane state is a configured test group.
 */
export function groupLanesOf(
  tiers: readonly GroupTierState[] | undefined,
  ownerOf: (ref: TestFileRef) => string,
): (ref: TestFileRef) => GroupLane | null {
  const byName = new Map((tiers ?? []).map((tier) => [tier.name, tier]));
  return (ref) => byName.get(ownerOf(ref)) ?? null;
}
