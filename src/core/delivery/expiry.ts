import {
  type AbsolutePath,
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type ConsumerRecord,
  type EpochMs,
  type HarnessProcess,
  type Store,
  WAITERLESS_EXPIRY_MS,
  type WorktreeId,
} from "../types/index.js";
import { removeWaiterLock, waiterLockState } from "../waiter-lock/index.js";
import { recordVersion } from "./consumer-version.js";
import { editsSaid, forgetEdits } from "./edits.js";
import {
  harnessGone,
  harnessOf,
  pidNamespace,
  recordedHarnesses,
  recordHarness,
  sameHarness,
} from "./harness-process.js";
import { tellLiveness, tellRevision } from "./liveness.js";
import { park } from "./registered.js";
import { slot } from "./slots.js";
import { writeTurn } from "./turn.js";

export interface ExpiryOptions {
  /**
   * The store's `locks/` directory. With it, expiry removes the free lock
   * files of the consumers it expires and also expires waiterless consumers
   * (`WAITERLESS_EXPIRY_MS`). Without it, only the 12 hour rule applies.
   */
  readonly locksDir?: AbsolutePath;
}

/**
 * Spec 001 D10: "A consumer that has not been delivered to or heard from for
 * 12 hours is expired". The daemon calls this periodically; returns the
 * consumers removed with their views.
 *
 * Lessons, defects 8 and 10 (task 001-47): Claude Code runs no SessionEnd
 * after an interactive exit that followed a typed prompt, but it kills the
 * idle waiter, whose lock file stays behind. So a consumer whose waiter lock
 * file exists, is held by no waiter, and that has not been delivered to or
 * heard from for 10 minutes is expired too, and its lock file removed. The
 * lock is only probed, never kept, so a waiter arming meanwhile is not
 * refused; the staleness is checked again in the transaction that removes
 * the consumer, so a hook that touched it in between keeps it.
 */
export function expireConsumers(
  store: Store,
  now: EpochMs = Date.now(),
  options: ExpiryOptions = {},
): readonly Consumer[] {
  // Reviews wave 12, S1: the 12 h backstop cleans up and stamps the departure as every unregister does.
  const expired = [
    ...store.transaction(() => {
      const gone = store.consumers.expire(now - CONSUMER_EXPIRY_MS);
      for (const consumer of gone) {
        forget(store, consumer);
        store.meta.set(departedMetaKey(consumer.worktreeId), String(now));
      }
      return gone;
    }),
  ];
  const { locksDir } = options;
  if (locksDir === undefined) return expired;
  for (const consumer of expired) removeWaiterLock(locksDir, consumer);

  const cutoff = now - WAITERLESS_EXPIRY_MS;
  for (const { consumer } of store.consumers.idleSince(cutoff)) {
    if (waiterLockState(locksDir, consumer) !== "free") continue;
    const gone = store.transaction(() => {
      const record = store.consumers.get(consumer);
      if (record === null || !idle(record, cutoff)) return false;
      drop(store, consumer, now);
      return true;
    });
    if (!gone) continue;
    removeWaiterLock(locksDir, consumer);
    expired.push(consumer);
  }
  return expired;
}

export interface HarnessDropOptions {
  readonly locksDir: AbsolutePath;
  /** Default: `harnessGone` in this process's PID namespace. */
  readonly isGone?: (harness: HarnessProcess) => boolean;
}

/**
 * Lessons, defect 24: a consumer whose recorded harness process is gone is
 * unregistered at once, with its waiter lock file, since a killed harness
 * runs no SessionEnd. Each process is checked once, however many consumers
 * it hosted (`/clear`, subagents, a Codex `app-server`). A consumer with no
 * recorded process, or one in another PID namespace, is left to the expiry
 * above. The record is compared again in the removing transaction, so a
 * consumer re-registered from a new process meanwhile stays. Returns the
 * consumers dropped.
 */
export function dropGoneHarnesses(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  options: HarnessDropOptions,
): readonly Consumer[] {
  const namespace = pidNamespace();
  const isGone = options.isGone ?? ((harness) => harnessGone(harness, namespace));
  const recorded = recordedHarnesses(store, worktreeId);
  const verdicts = new Map<string, boolean>();
  const dropped: Consumer[] = [];
  for (const { consumer } of store.consumers.list(worktreeId)) {
    const harness = recorded.get(slot(consumer));
    if (harness === undefined) continue;
    const id = `${harness.pidNamespace}/${harness.pid}/${harness.startTime}`;
    const gone = verdicts.get(id) ?? isGone(harness);
    verdicts.set(id, gone);
    if (!gone) continue;
    const removed = store.transaction(() => {
      const current = store.consumers.get(consumer) === null ? null : harnessOf(store, consumer);
      if (current === null || !sameHarness(current, harness)) return false;
      drop(store, consumer, now);
      return true;
    });
    if (!removed) continue;
    removeWaiterLock(options.locksDir, consumer);
    dropped.push(consumer);
  }
  return dropped;
}

/**
 * Unregisters `consumer` the way `HarnessDelivery.unregister` does, and
 * stamps the worktree's last departure. Call inside a transaction.
 */
export function drop(store: Store, consumer: Consumer, at: EpochMs): void {
  park(store, consumer, at, { said: editsSaid(store, consumer) });
  store.consumers.unregister(consumer);
  forget(store, consumer);
  store.meta.set(departedMetaKey(consumer.worktreeId), String(at));
}

/** `meta` key of the time a consumer of the worktree last unregistered or was dropped. */
export function departedMetaKey(worktreeId: WorktreeId): string {
  return `departed:${worktreeId}`;
}

/**
 * When a consumer of `worktreeId` last left (lessons, defect 24): a session
 * that registers and ends between two of the daemon's counts still makes a
 * daemon that had it exit. `null` when none left or the row is unreadable.
 */
export function lastDeparture(store: Store, worktreeId: WorktreeId): EpochMs | null {
  const at = Number(store.meta.get(departedMetaKey(worktreeId)) ?? Number.NaN);
  return Number.isFinite(at) ? at : null;
}

/**
 * Drops what an unregistered consumer was told, its turn state, its harness
 * process, its version and its edit state, beside its view.
 */
function forget(store: Store, consumer: Consumer): void {
  tellLiveness(store, consumer, null);
  tellRevision(store, consumer, null);
  writeTurn(store, consumer, null);
  recordHarness(store, consumer, null);
  recordVersion(store, consumer, null);
  forgetEdits(store, consumer);
}

/** `ConsumerRepo.idleSince` for one record. */
function idle(record: ConsumerRecord, cutoff: EpochMs): boolean {
  return record.lastSeenAt < cutoff && (record.lastDeliveredAt ?? 0) < cutoff;
}
