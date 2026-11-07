import type { WorktreeId } from "../types/common.js";
import type { Consumer } from "../types/delivery.js";
import type { GroupTierState, SlowTierState } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Task 001-407, decided by the human: a change delivery carries the slow-tier
 * line only when the slow tier's state changed since the consumer was last
 * shown it, at registration, at Stop or in a delivery that carried it. The
 * state is what the slow files' results are: their counts and the
 * revisions the current ones ran at. What the daemon is doing about the
 * pending ones (`activity`) and the Stop policy are not: a file starting to
 * run is no result.
 */

/** `meta` key of the slow-tier state each consumer of a worktree was last shown. */
export function slowToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("slowTierTold", worktreeId);
}

/** The slow tier's state as one string; `null` without a slow tier. */
export function slowTierState(tier: SlowTierState | undefined): string | null {
  if (tier === undefined) return null;
  return JSON.stringify([
    tier.testFiles,
    tier.current,
    tier.pending,
    tier.notRun,
    tier.currentAt,
    tier.currentUpTo ?? null,
  ]);
}

/** Whether `tier` differs from what `consumer` was last shown; a consumer never shown one reads as changed. */
export function slowTierChanged(
  store: Store,
  consumer: Consumer,
  tier: SlowTierState | undefined,
): boolean {
  const state = slowTierState(tier);
  return (
    state !== null && readSlot(store, slowToldMetaKey(consumer.worktreeId), consumer) !== state
  );
}

/** Records the slow tier as shown to `consumer`; `undefined` forgets it. Call inside a transaction. */
export function tellSlowTier(store: Store, consumer: Consumer, tier: SlowTierState | undefined) {
  writeSlot(store, slowToldMetaKey(consumer.worktreeId), consumer, slowTierState(tier));
}

/*
 * Row 019-16 (spec 019 D6): the configured groups' lines follow the same
 * rule as the slow-tier line, under their own key, so a consumer's slow-tier
 * record is as before. Absent without a `checks` key: nothing is written.
 */

/** `meta` key of the groups' state each consumer of a worktree was last shown. */
export function groupsToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("groupTiersTold", worktreeId);
}

/** The groups' states as one string, each by name as `slowTierState` counts it; `null` without groups. */
export function groupTiersState(groups: readonly GroupTierState[] | undefined): string | null {
  if (groups === undefined) return null;
  return JSON.stringify(groups.map((group) => [group.name, slowTierState(group)]));
}

/** Whether `groups` differ from what `consumer` was last shown; never shown reads as changed. */
export function groupTiersChanged(
  store: Store,
  consumer: Consumer,
  groups: readonly GroupTierState[] | undefined,
): boolean {
  const state = groupTiersState(groups);
  return (
    state !== null && readSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer) !== state
  );
}

/** Records the groups as shown to `consumer`; `undefined` forgets them. Call inside a transaction. */
export function tellGroupTiers(
  store: Store,
  consumer: Consumer,
  groups: readonly GroupTierState[] | undefined,
) {
  writeSlot(store, groupsToldMetaKey(consumer.worktreeId), consumer, groupTiersState(groups));
}
