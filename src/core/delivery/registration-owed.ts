import { isRecord } from "../fs/json.js";
import type { WorktreeId } from "../types/common.js";
import type { Consumer } from "../types/delivery.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Row 005-98 (the coordinator's decision C, 2026-11-17): a session reads its
 * registration text once; a new session reads it with the primer, a resumed
 * one without. A session start registers before it starts the daemon, so a
 * hook killed at its timeout after the registration and before its output
 * leaves a registered consumer that heard nothing. Each registration records
 * the text it owes (`RegisterOptions.owesText`); the hook clears it in a
 * write held until its output is written (`HarnessDelivery.registrationSent`,
 * row 011-288's hand-off). A tool boundary or a prompt that finds the
 * consumer registered with its text still owed says the registration again.
 * A kill between the output and the clear gives the text twice. A
 * registration that owes nothing clears it; the slot ends with the consumer
 * (it is read only while registered, and `writeSlot` drops it at the next
 * write).
 */

/** What a registration's text carries: the primer, or not (a resumed session). */
export interface OwedRegistration {
  readonly primer: boolean;
}

/** `meta` key of the registration texts the worktree's consumers have not been handed. */
export function registrationOwedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("registrationOwed", worktreeId);
}

/** Records the text `consumer`'s registration owes; `null` when none. Call inside a transaction. */
export function oweRegistration(
  store: Store,
  consumer: Consumer,
  owed: OwedRegistration | null,
): void {
  const key = registrationOwedMetaKey(consumer.worktreeId);
  if (owed === null && readSlot(store, key, consumer) === undefined) return;
  writeSlot(store, key, consumer, owed === null ? null : { primer: owed.primer });
}

/**
 * The text `consumer`'s registration still owes; `null` when it was handed, none was owed, or
 * the consumer is not registered (its slot is dropped at the next write).
 */
export function owedRegistration(store: Store, consumer: Consumer): OwedRegistration | null {
  if (store.consumers.get(consumer) === null) return null;
  const value = readSlot(store, registrationOwedMetaKey(consumer.worktreeId), consumer);
  return isRecord(value) && typeof value.primer === "boolean" ? { primer: value.primer } : null;
}
