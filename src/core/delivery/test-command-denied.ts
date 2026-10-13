import { type Consumer, type Store, type WorktreeId, worktreeMetaKey } from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Spec 005 D8 step 4: a test command is denied at most once per consumer.
 * After one deny every test command of that session or subagent runs. One
 * slot per consumer, holding the revision of its deny; a consumer that
 * unregisters loses it with its other slots.
 */

/** `meta` key of a worktree's consumers already denied a test command. */
export function testCommandDeniedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("testCommandDenied", worktreeId);
}

/** Whether `consumer` was denied a test command before. */
export function testCommandDenied(store: Store, consumer: Consumer): boolean {
  return readSlot(store, testCommandDeniedMetaKey(consumer.worktreeId), consumer) !== undefined;
}

/** Records that `consumer` was denied a test command at `revision`. Call inside a transaction. */
export function recordTestCommandDenied(store: Store, consumer: Consumer, revision: number): void {
  writeSlot(store, testCommandDeniedMetaKey(consumer.worktreeId), consumer, revision);
}
