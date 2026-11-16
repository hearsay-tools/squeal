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
 * Row 019-16 (spec 019 D6): the configured groups' lines are told under their
 * own key, so a consumer's slow-tier record is as before. Absent without a
 * `checks` key: nothing is written. Row 005-91 (b): a group line went out
 * whenever a count moved (the `browser:` line was in 346 of 1,081 cezar
 * messages); now only when a group's kind changes (`groupKind`). A failure
 * says itself in its own FAIL block and adds no group line. The slow-tier
 * line keeps its rule above.
 */

/** A group's kind: what its line tells the agent to do, which a moving count does not change. */
export type GroupKind = "current" | "waiting" | "not run";

/** `current` with every listed file current (or none listed), `waiting` with any pending, else `not run`. */
export function groupKind(group: GroupTierState): GroupKind {
  if (group.current >= group.testFiles) return "current";
  return group.pending > 0 ? "waiting" : "not run";
}

/** `meta` key of the groups' state each consumer of a worktree was last shown. */
export function groupsToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("groupTiersTold", worktreeId);
}

/** The groups' kinds as one string, each by name (`groupKind`); `null` without groups. */
export function groupTiersState(groups: readonly GroupTierState[] | undefined): string | null {
  if (groups === undefined) return null;
  return JSON.stringify(groups.map((group) => [group.name, groupKind(group)]));
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
