import { type PoolLane, poolLaneOf as priorityLane } from "../capacity/pool.js";
import { slotFiles } from "../slow/slot-files.js";
import type { ResolvedGroup } from "../types/check-groups.js";
import type { AbsolutePath } from "../types/common.js";
import type { Policy } from "../types/policy.js";
import type { SlotScope } from "./options.js";
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

/** The pool lane a group's tiers wait in (`TierCapacity.take`): its priority's (row 019-11). */
export function poolLaneOf(group: ResolvedGroup): PoolLane {
  return priorityLane(group.limits.priority);
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
 * 2, mapping 1): at `edit` with no `after` and no `quietMs`, of `normal`
 * priority and with no `maxWorkers` (a grant is what bounds a run's
 * workers and orders a `low` waiter). It takes no pool grant and only
 * writes its mark while it runs; every other group's tier waits for one.
 */
export function ungated(group: ResolvedGroup): boolean {
  const { at, after, quietMs, limits } = group;
  return (
    at === "edit" &&
    after.length === 0 &&
    quietMs === 0 &&
    limits.priority === "normal" &&
    limits.maxWorkers === null
  );
}

/**
 * The directory of a group's `maxParallel` slot in `base` (spec 019 D3, row
 * 019-11's `slotFiles`): `base` itself under `"user"`, the default when no
 * scope is given, and the repository's `repo.<key>` in it under
 * `"repository"`, the host config's default. The files' names are the
 * group's in both: `slow.lock` and `slow.<i>.lock` for the default `slow`
 * group, `group.<name>.<i>.lock` for a configured one.
 */
export function slotDirOf(group: string, base: AbsolutePath, at?: SlotScope): AbsolutePath {
  return slotFiles(group, at?.scope ?? "user").dir(base, at?.commonDir ?? base);
}
