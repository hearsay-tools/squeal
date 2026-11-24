import { durationText } from "../core/text.js";
import type { EpochMs, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SlowTierActivity } from "../core/types/status.js";
import type { Store } from "../core/types/store.js";
import type { SideWaiting } from "./status-at-estimate-waits.js";

/*
 * Row 023-84 (dogfood round 11, AA4): s1b-03 read "1 of 1 queued at
 * d8abcfe46, waiting for the browser group's run of
 * packages/web/e2e/thread-scroll.e2e.ts to end" while that run, of the same
 * file on the same side, had started at a key the file no longer had. Its
 * result did not count, and the file ran again after it; the agent waited
 * 4 more minutes and could not see why.
 *
 * The daemon records it this way: its lane publishes the run of the file
 * (`running`), the store holds that run open, and the file's key row reads
 * `queued`, not `running`. A run at the file's current key marks the row
 * `running` in the transaction that publishes the activity, so a queued
 * row beside an open run of the same file is a run at an older key.
 */

/**
 * The wait of a side's `queued` files of one group whose lane `activity`
 * runs some of them at an older key, by `who` (`the commit worktree`);
 * `null` when the lane runs none of them, or the store holds no open run
 * of them.
 */
export function staleRunWait(
  store: Store,
  id: WorktreeId,
  activity: SlowTierActivity | null,
  queued: readonly TestFileRef[],
  who: string,
  now: number,
): SideWaiting | null {
  if (activity?.kind !== "running") return null;
  const running = new Set(activity.paths ?? [activity.path]);
  const named = queued.filter((ref) => running.has(ref.path));
  if (named.length === 0) return null;
  const open = store.runs.inFlight(id, 0 as EpochMs);
  const stale = named.filter((ref) =>
    open.some((run) => run.testFiles.some((f) => f.project === ref.project && f.path === ref.path)),
  );
  if (stale.length === 0) return null;
  return { reason: staleText(stale, activity, who, now), capacity: false };
}

/**
 * `the commit worktree's run of a.e2e.ts to end: that run started before
 * its inputs changed (running for 2 min, about 57 s left), so its result
 * will not count, and the file runs again after it`. The time left is the
 * lane's stored duration less the time run, shown from 1 s up.
 */
function staleText(
  stale: readonly TestFileRef[],
  activity: Extract<SlowTierActivity, { kind: "running" }>,
  who: string,
  now: number,
): string {
  const paths = stale.map((ref) => ref.path);
  const last = paths.at(-1) ?? "";
  const list = paths.length < 2 ? last : `${paths.slice(0, -1).join(", ")} and ${last}`;
  const ranMs = Math.max(0, now - activity.since);
  const leftMs = activity.lastDurationMs === null ? 0 : activity.lastDurationMs - ranMs;
  const left = leftMs >= 1000 ? `, about ${durationText(leftMs)} left` : "";
  const one = stale.length === 1;
  return (
    `${who}'s run of ${list} to end: that run started before ${one ? "its" : "their"} inputs changed ` +
    `(running for ${durationText(ranMs)}${left}), so its result will not count, ` +
    `and ${one ? "the file runs" : "the files run"} again after it`
  );
}
