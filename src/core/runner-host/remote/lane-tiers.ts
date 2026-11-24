import { isBesideLane, isSlowLane, type RunOptions } from "../../types/runner.js";
import { isGroupLane } from "../../types/scheduler.js";
import type { RemoteTier } from "./settings.js";

/*
 * Spec 026 D8.1 (row 026-11): which of `remote.json`'s tiers a run is, and
 * so whether it goes to the remote. 021 D12's default, `["background"]`,
 * sends a background tier in the runner's own lane alone.
 *
 * - `slow`: a run of the slow lane (`slow:<runner>`).
 * - `group`: a run of another check group's lane (`group:<name>:<runner>`).
 * - `background`: a backlog tier or the backlog's turn (`RunOptions.background`).
 * - `edit`: every other run of the runner's own lane (an edit's tier, a
 *   focused one, a named wait's batch) and a tier beside a named wait's
 *   batch (`beside:<runner>`): someone waits for each here. A beside tier
 *   goes remote with `edit`, and stays here otherwise.
 */

/** 021 D12: the tiers of a lane that names none. */
export const DEFAULT_TIERS: readonly RemoteTier[] = ["background"];

/** The tier of `remote.json` that the run `options` is. */
export function remoteTierOf(options: RunOptions): RemoteTier {
  const lane = options.lane ?? "";
  if (isSlowLane(lane)) return "slow";
  if (isGroupLane(lane)) return "group";
  if (isBesideLane(lane)) return "edit";
  return options.background === true ? "background" : "edit";
}

/** Whether the run `options` goes remote on a lane that serves `tiers` (D8.1). */
export function goesRemote(
  options: RunOptions,
  tiers: readonly RemoteTier[] = DEFAULT_TIERS,
): boolean {
  return tiers.includes(remoteTierOf(options));
}

/** The tiers' names for a status line: `background`, or `edit and background`. */
export function tiersText(tiers: readonly RemoteTier[]): string {
  if (tiers.length <= 1) return tiers[0] ?? "background";
  return `${tiers.slice(0, -1).join(", ")} and ${tiers.at(-1)}`;
}
