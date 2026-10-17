import { skippedReason } from "../state/index.js";
import {
  type Consumer,
  type SlowTierState,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Task 001-407, decided by the human: a change delivery carries the slow-tier
 * line only when the slow tier's state changed since the consumer was last
 * shown it, at registration, at Stop or in a delivery that carried it. The
 * state is what the slow files' results are: their counts, the revisions and
 * artifact the current ones ran against, and whether sources changed since.
 * What the daemon is doing about the pending ones (`activity`) and the Stop
 * policy are not: a file starting to run is no result. A skip is (task
 * 004-65): its precondition's reason is told once, when the tier is skipped.
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
    tier.artifact,
    tier.artifactUnknown ?? 0,
    tier.sourcesChangedSince,
    // A skip is a state (004 D8 as amended 2026-10-17): its reason is told once, as it changes.
    ...(skippedReason(tier) === null ? [] : [skippedReason(tier)]),
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
