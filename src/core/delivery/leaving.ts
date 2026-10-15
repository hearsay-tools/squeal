import { isRecord } from "../fs/index.js";
import {
  type Consumer,
  type EpochMs,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { readAll, readSlot, writeSlot } from "./slots.js";

/*
 * Task 001-416: SubagentStop unregisters its consumer only after it waited
 * for pending checks and delivered, inside a 2 s hook timeout; under load
 * the harness kills it first and the registration outlives the subagent. So
 * the hook marks the consumer leaving before it waits. A block clears the
 * mark, since the subagent goes on, and so does any later boundary of the
 * consumer, its registration and every PreToolUse included (review 001-423,
 * B1); the daemon drops a consumer whose mark is older than
 * `LEAVING_GRACE_MS` (`dropLeft`).
 */

/** `meta` key of a worktree's leaving marks. */
export function leavingMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("leaving", worktreeId);
}

/** Marks `consumer` leaving at `at`; `null` clears the mark. Call inside a transaction. */
export function markLeaving(store: Store, consumer: Consumer, at: EpochMs | null): void {
  const key = leavingMetaKey(consumer.worktreeId);
  if (at === null && readSlot(store, key, consumer) === undefined) return;
  writeSlot(store, key, consumer, at === null ? null : { at });
}

/** Whether `consumer` is marked leaving. Reads only. */
export function isLeaving(store: Store, consumer: Consumer): boolean {
  return readSlot(store, leavingMetaKey(consumer.worktreeId), consumer) !== undefined;
}

/** When each marked consumer of `worktreeId` was marked, by slot. */
export function leavingMarks(store: Store, worktreeId: WorktreeId): ReadonlyMap<string, EpochMs> {
  const marks = new Map<string, EpochMs>();
  for (const [name, value] of Object.entries(readAll(store, leavingMetaKey(worktreeId)))) {
    if (isRecord(value) && typeof value.at === "number") marks.set(name, value.at);
  }
  return marks;
}
