import { readSlot, writeSlot } from "../delivery/slots.js";
import { isRecord } from "../fs/index.js";
import {
  type Consumer,
  type Policy,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Spec 004 D9 as amended 2026-10-12 (task 001-285): which harness's waiting
 * Stop entry (`stop-slow`) ran for a session, and at which Squeal version. A
 * main agent's 2 s Stop leaves slow files to that entry only once it is known
 * to run there: Codex runs a new plugin hook only after the user trusts it,
 * and an untrusted or missing waiting entry must leave
 * `stop.requireSlowSuite` holding as it did before, never holding nothing.
 *
 * Task 001-297 (review wave 13am S1): the evidence is the consumer's, one
 * slot per consumer in one row per worktree (`slots.ts`),
 * `{ "<session>\n<agent>": { "<harness>": "<version>" } }`. Another session
 * in the worktree, with another config, launcher or trust, never inherits
 * it: its first Stop blocks on slow files as before, and its own waiting
 * entry, if it runs, marks it. The evidence lasts while the consumer is
 * registered; a slot of one no longer registered is dropped on the next
 * write. A waiting entry disabled mid-session is not seen: the slot stays
 * until the session ends.
 */

/**
 * The longest `stop.slowWaitMs` honoured: 10 minutes, `slow.maxDeferMs`'s
 * default, below the waiting entry's hook timeout.
 */
export const STOP_SLOW_WAIT_CAP_MS = 600_000;

/** How long a Stop waits for slow files under `policy`; `null` with `stop.requireSlowSuite` off. */
export function stopSlowWaitMs(policy: Policy): number | null {
  if (!policy.stop.requireSlowSuite) return null;
  return Math.max(0, Math.min(policy.stop.slowWaitMs, STOP_SLOW_WAIT_CAP_MS));
}

/** The harnesses with a waiting Stop entry. */
export type StopWaitHarness = "claude-code" | "codex";

/** `meta` key of a worktree's waiting-entry record. */
export function stopWaitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("stopWait", worktreeId);
}

/** Whether `harness`'s waiting entry ran for `consumer` at `version`. */
export function stopWaitRuns(
  store: Store,
  consumer: Consumer,
  harness: StopWaitHarness,
  version: string,
): boolean {
  const value = readSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer);
  return isRecord(value) && value[harness] === version;
}

/** Records that `harness`'s waiting entry runs for `consumer` at `version`; writes only a change. */
export function recordStopWait(
  store: Store,
  consumer: Consumer,
  harness: StopWaitHarness,
  version: string,
): void {
  store.transaction(() => {
    if (stopWaitRuns(store, consumer, harness, version)) return;
    writeSlot(store, stopWaitMetaKey(consumer.worktreeId), consumer, { [harness]: version });
  });
}
