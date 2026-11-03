import { join } from "node:path";
import type { PoolLane } from "../capacity/index.js";
import { type AbsolutePath, type Policy, type ResolvedGroup, SLOW_GROUP } from "../types/index.js";
import type { TierKind } from "./tiers.js";

/*
 * Spec 019 D3 for one group's lane, as wave 2's priority contract states
 * it. `"low"` is today's slow behaviour: the pool's `"slow"` waiter order,
 * a tier nothing cancels, one file at a time while normal work is pending
 * or the load is above the bound. `"normal"` is today's fast behaviour: the
 * pool's `"fast"` order, full width, and a tier a new edit may cancel when
 * its runner cancels (a Vitest tier). `ionice` by priority is row 019-12's
 * (`Tier.priority`).
 */

/** The pool lane a group's tiers wait in (`TierCapacity.take`). */
export function poolLaneOf(group: ResolvedGroup): PoolLane {
  return group.limits.priority === "low" ? "slow" : "fast";
}

/** The kind of a group's tier: `slow` runs to its end on a new edit; `edit` may be cancelled. */
export function tierKindOf(group: ResolvedGroup): TierKind {
  return group.limits.priority === "low" ? "slow" : "edit";
}

/** The most files one tier of the group takes: `maxParallel`, else an edit's tier size. */
export function fullWidth(group: ResolvedGroup, policy: Policy): number {
  return Math.max(1, group.limits.maxParallel ?? policy.runner.tierSize);
}

/** Workers per file of a tier of the group: `maxWorkers`, else one, as a backlog file takes. */
export function workersPerFile(group: ResolvedGroup): number {
  return Math.max(1, group.limits.maxWorkers ?? 1);
}

/**
 * A tier an edit starts, as the `tests` group's (`research/lanes-survey.md`
 * 2, mapping 1): at `edit` with no `after` and no `quietMs`. It takes no
 * pool grant and only writes its mark while it runs; every other group's
 * tier waits for a grant.
 */
export function ungated(group: ResolvedGroup): boolean {
  return group.at === "edit" && group.after.length === 0 && group.quietMs === 0;
}

/**
 * The directory of a group's `maxParallel` slot, per user (wave 2's slot
 * contract, pending spec open question 8): the default `slow` group's is
 * `base`, today's; a configured group's is `group.<name>` in it, until row
 * 019-11 names the files `group.<name>.*.lock` in `base` itself.
 */
export function slotDirOf(group: string, base: AbsolutePath): AbsolutePath {
  return group === SLOW_GROUP ? base : (join(base, `group.${group}`) as AbsolutePath);
}
