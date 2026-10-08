import type { Consumer, Store, WorktreeId } from "../types/index.js";
import { readAll, slot, writeSlot } from "./slots.js";

/*
 * The Squeal version of the hook each consumer registered with (task
 * 001-130, review wave 12b B1). A hook asks an older daemon to step down
 * only while no consumer of an older or unknown version is registered, so a
 * released older hook cannot take the next boundary and start a daemon
 * older than the one that stepped down. Kept in `meta` beside the consumer,
 * like its harness process; a consumer registered by a hook from before this
 * record has none.
 */

/** `meta` key of a worktree's recorded consumer versions. */
export function versionMetaKey(worktreeId: WorktreeId): string {
  return `consumer-version:${worktreeId}`;
}

/** Records the version `consumer` registered with; `null` forgets it. Call inside a transaction. */
export function recordVersion(store: Store, consumer: Consumer, version: string | null): void {
  writeSlot(store, versionMetaKey(consumer.worktreeId), consumer, version);
}

/**
 * The recorded version of every consumer of `consumer`'s worktree registered
 * outside its session, `null` for one registered without a version. The
 * session's own consumers (its main agent and subagents) run the hooks of
 * one installed plugin, the one asking.
 */
export function otherSessionVersions(store: Store, consumer: Consumer): (string | null)[] {
  const recorded = readAll(store, versionMetaKey(consumer.worktreeId));
  return store.consumers
    .list(consumer.worktreeId)
    .filter((r) => r.consumer.sessionId !== consumer.sessionId)
    .map((r) => {
      const version = recorded[slot(r.consumer)];
      return typeof version === "string" ? version : null;
    });
}
