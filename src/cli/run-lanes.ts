import { worktreeSlowView } from "../core/state/index.js";
import type { CheckpointLane, CheckpointRecord, Store, TestFileRef } from "../core/types/index.js";

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
 * verdict is on (task 004-61); `null` for a checkpoint of both lanes.
 */
export function laneFiles(store: Store, checkpoint: CheckpointRecord): TestFileRef[] | null {
  const { lane, worktreeId } = checkpoint;
  if (lane === undefined) return null;
  const isSlow = worktreeSlowView(store, worktreeId)?.isSlow ?? (() => false);
  return store.testFileKeys
    .list(worktreeId)
    .map((row) => row.testFile)
    .filter((ref) => isSlow(ref) === (lane === "slow"));
}
