import { readPolicy } from "../core/daemon/policy.js";
import { slowView } from "../core/scheduler/slow.js";
import type { WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import type { CheckpointLane, CheckpointRecord } from "../core/types/store-records.js";

/**
 * What `run` was asked for (task 004-61): `--all` both lanes, `--fast` the
 * fast lane's checkpoint, `--slow` the slow lane (`run --slow`, with or
 * without `--all`). `--fast --slow` is both lanes, as `--all` is. `null`
 * when no lane flag is given.
 */
export type RunLanes = "both" | CheckpointLane;

export function runLanes(flags: ReadonlySet<string>): RunLanes | null {
  const fast = flags.has("--fast");
  const slow = flags.has("--slow");
  if (fast && slow) return "both";
  if (fast) return "fast";
  if (slow) return "slow";
  return flags.has("--all") ? "both" : null;
}

/** The lane flags, which `run --all` reads as its own. */
export const LANE_FLAGS: readonly string[] = ["--all", "--fast", "--slow"];

/**
 * The checkpoint's lane after its id (task 004-61): a one-lane checkpoint
 * says it is not a full-suite one. A daemon from before lanes ignored the
 * request's lane and ran both, which is said too.
 */
export function laneText(checkpoint: CheckpointRecord, asked: CheckpointLane | null): string {
  const lane = checkpoint.lane;
  if (lane !== undefined) {
    const other = lane === "fast" ? "slow" : "fast";
    return ` (the ${lane} lane only, not a full-suite checkpoint: ${other} test files are not in it)`;
  }
  return asked === null ? "" : ` (both lanes: this daemon predates \`--${asked}\`)`;
}

/**
 * The worktree's listed test files of a one-lane checkpoint's lane, which its
 * verdict is on (task 004-61); `null` for a checkpoint of both lanes. Row
 * 011-328: the guess a checkpoint wait keeps when the daemon's answer names
 * no covered-files record, or one that is gone (`requestFiles`). The
 * lane is the daemon's (`slowView`, which `requestFullSuite` filters by)
 * under the policy at the worktree's root: a file of any group but `tests`
 * is outside the fast lane, a manual one too (row 018-11). A policy change
 * is a revision, which ends the wait before the two policies can differ.
 */
export function laneFiles(
  store: Store,
  worktreeId: WorktreeId,
  lane: CheckpointLane | null,
): TestFileRef[] | null {
  if (lane === null) return null;
  const root = store.worktrees.get(worktreeId)?.root;
  const isSlow = root === undefined ? () => false : slowView(readPolicy(root)).isSlow;
  return store.testFileKeys
    .list(worktreeId)
    .map((row) => row.testFile)
    .filter((ref) => isSlow(ref) === (lane === "slow"));
}
