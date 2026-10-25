import { readPolicy } from "../daemon/policy.js";
import {
  type Consumer,
  type Delta,
  type StatusHeader,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Row 011-205 (C5 as amended): a consumer whose registration header said the
 * daemon had not listed the test files is owed the full counts. Its first
 * delivery after the listing, news or Stop, carries them once: the current
 * and inherited counts, the test files without checks, and that a
 * lookup-only baseline queued none of them. Cezar session d0412a5f read
 * "Test files without checks: 97 unknown" and never learned that 921 test
 * files were current, most of them inherited.
 */

/** `meta` key of the consumers of a worktree owed the counts after the listing. */
export function countsOwedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("countsOwed", worktreeId);
}

/** At registration: `consumer` is owed the counts when `header` says the test files are not listed. Call inside a transaction. */
export function oweCounts(store: Store, consumer: Consumer, header: StatusHeader): void {
  writeSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer, owed(header) ? true : null);
}

/** Forgets what `consumer` is owed. Call inside a transaction. */
export function forgetCounts(store: Store, consumer: Consumer): void {
  writeSlot(store, countsOwedMetaKey(consumer.worktreeId), consumer, null);
}

/**
 * At a delivery: `Delta.countsOwed` when `consumer` is owed the counts and
 * `header` is listed, which pays them; nothing otherwise. Call inside a
 * transaction.
 */
export function payCounts(
  store: Store,
  consumer: Consumer,
  header: StatusHeader,
): Pick<Delta, "countsOwed"> {
  const key = countsOwedMetaKey(consumer.worktreeId);
  if (owed(header) || readSlot(store, key, consumer) !== true) return {};
  writeSlot(store, key, consumer, null);
  const root = store.worktrees.get(consumer.worktreeId)?.root;
  const lookupOnly = root !== undefined && readPolicy(root).baseline.onStart === "lookup-only";
  return { countsOwed: { lookupOnly } };
}

const owed = (header: StatusHeader) => header.testFilesListed === false;
