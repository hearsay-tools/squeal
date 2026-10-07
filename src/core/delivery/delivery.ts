import { setTimeout as sleep } from "node:timers/promises";
import { baselineFindings, toKnownFailure } from "../state/index.js";
import {
  type AbsolutePath,
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type ConsumerRecord,
  type Delta,
  type DeltaEntry,
  type EpochMs,
  type HarnessDelivery,
  type KnownState,
  PAYLOAD_SCHEMA_VERSION,
  type StatusBuilder,
  type Store,
  WAITERLESS_EXPIRY_MS,
} from "../types/index.js";
import { removeWaiterLock, waiterLockState } from "../waiter-lock/index.js";
import { type DeltaPlan, isBaselineEntry, planDelta, restrictPlan, toView } from "./delta.js";
import { readLiveHeader, tellLiveness, toldLiveness, worktreeLiveness } from "./liveness.js";
import { endTurn, readTurn, startTurn, waitedFor, writeTurn } from "./turn.js";

export interface DeliveryOptions {
  /** Builds `status()`; task 001-22 owns the implementation. */
  readonly status: StatusBuilder;
  /** Clock for view and consumer times. Default `Date.now`. */
  readonly now?: () => EpochMs;
  /** How often `waitForDelta` re-reads the store. Default `DEFAULT_POLL_INTERVAL_MS`. */
  readonly pollIntervalMs?: number;
}

/** A store read costs well under a millisecond; four reads a second keep an idle wake-up prompt. */
export const DEFAULT_POLL_INTERVAL_MS = 250;

interface DeliverOptions {
  readonly heardFrom: boolean;
  readonly keep?: ((entry: DeltaEntry) => boolean) | null;
  readonly liveness?: boolean;
  readonly idle?: boolean;
}

const isEmpty = (plan: DeltaPlan) =>
  plan.entries.length === 0 && plan.writes.length === 0 && plan.removals.length === 0;

/**
 * The store-backed `HarnessDelivery` (spec 001 D6, D9). Hooks and the daemon
 * can both use it: it needs only the store.
 *
 * A consumer that is not registered (never, unregistered or expired) gets
 * `null` from `onToolBoundary` and `waitForDelta` and no view is written:
 * only `register` seeds a view, so failures that exist before it are never
 * delivered as transitions.
 */
export function createDelivery(store: Store, options: DeliveryOptions): HarnessDelivery {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  function plan(
    consumer: Consumer,
    states: readonly KnownState[],
    toldAt: EpochMs,
    keep: ((entry: DeltaEntry) => boolean) | null,
  ): DeltaPlan {
    const full = planDelta({
      view: store.views.list(consumer),
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
      revision: store.revisions.latest(consumer.worktreeId)?.number ?? 0,
      history: (check) => store.transitions.history(consumer.worktreeId, check),
    });
    return keep === null ? full : restrictPlan(full, keep);
  }

  /** The daemon's liveness when it differs from what `consumer` was told, else `null`. */
  function livenessChange(consumer: Consumer, at: EpochMs) {
    const live = worktreeLiveness(store.worktrees.get(consumer.worktreeId), at);
    return live.state === toldLiveness(store, consumer) ? null : live;
  }

  /**
   * Reads the delta, writes the view and returns the delta, in one
   * transaction. `heardFrom` records the consumer as seen even when nothing
   * is delivered; a waiter's empty polls do not count. `keep` limits the
   * delivery to the entries it accepts (`peek`). `liveness` includes a
   * change of daemon liveness: tool boundaries only, since a peek is for
   * regressions and waking an idle agent to say the daemon stopped helps no
   * one (review wave 3, S2). `idle` is the waiter's (task 001-85): nothing
   * unless the consumer is idle, only entries it waited for, and a delivery
   * starts a turn, since it wakes the agent. A consumer heard from is in a
   * turn, delivered to or not (task 001-89, review wave 10 S2): a tool call
   * corrects an idle state a Stop that was not the last word, or a failed
   * UserPromptSubmit, left behind.
   */
  function deliver(
    consumer: Consumer,
    { heardFrom, keep = null, liveness = false, idle = false }: DeliverOptions,
  ): Delta | null {
    const select = (): ((entry: DeltaEntry) => boolean) | null | "silent" => {
      if (!idle) return keep;
      const turn = readTurn(store, consumer);
      return turn.turn === "idle" ? (entry) => waitedFor(turn, entry) : "silent";
    };
    if (!heardFrom) {
      // Read-only first: an idle waiter takes no write lock until there is something to write.
      if (store.consumers.get(consumer) === null) return null;
      const only = select();
      if (only === "silent") return null;
      const states = store.knownStates.list(consumer.worktreeId);
      const quiet = !liveness || livenessChange(consumer, now()) === null;
      if (quiet && isEmpty(plan(consumer, states, now(), only))) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      const only = select();
      if (only === "silent") return null;
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const delta = plan(consumer, states, at, only);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const changed = liveness ? livenessChange(consumer, at) : null;
      if (changed !== null) tellLiveness(store, consumer, changed.state);
      const delivered = delta.entries.length > 0 || changed !== null;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) return null;
      if (idle) startTurn(store, consumer);
      const label =
        delta.entries.length > 0 && delta.entries.every(isBaselineEntry)
          ? "baseline"
          : "transitions";
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header: readLiveHeader(store, consumer.worktreeId, at, states),
        label,
        entries: delta.entries,
        ...(changed === null ? {} : { liveness: changed }),
      };
    });
  }

  return {
    register: async (consumer, { inTurn = false } = {}) =>
      store.transaction(() => {
        const at = now();
        store.consumers.register(consumer, at);
        const states = store.knownStates.list(consumer.worktreeId);
        store.views.writeMany(
          consumer,
          states.map((s) => toView(s, at)),
        );
        const header = readLiveHeader(store, consumer.worktreeId, at, states);
        tellLiveness(store, consumer, header.daemon?.state ?? null);
        if (inTurn) startTurn(store, consumer);
        else writeTurn(store, consumer, null);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          consumer,
          header,
          knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
        };
      }),

    unregister: async (consumer) => {
      store.transaction(() => {
        store.consumers.unregister(consumer);
        tellLiveness(store, consumer, null);
        writeTurn(store, consumer, null);
      });
    },

    onToolBoundary: async (consumer) => deliver(consumer, { heardFrom: true, liveness: true }),

    peek: async (consumer, { kinds }) => {
      const only = new Set(kinds);
      return deliver(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) });
    },

    startTurn: async (consumer) => deliver(consumer, { heardFrom: true, liveness: true }),

    endTurn: async (consumer) => {
      store.transaction(() => {
        if (store.consumers.get(consumer) === null) return;
        const states = store.knownStates.list(consumer.worktreeId);
        endTurn(store, consumer, states, plan(consumer, states, now(), null).entries);
      });
    },

    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) return null;
        const delta = deliver(consumer, { heardFrom: false, idle: true });
        if (delta !== null) return delta;
        const left = deadline - performance.now();
        if (left <= 0) return null;
        try {
          await sleep(Math.min(pollIntervalMs, left), undefined, signal ? { signal } : {});
        } catch (error) {
          if (signal?.aborted) return null;
          throw error;
        }
      }
    },

    status: async (worktreeId) => options.status.build(worktreeId),
  };
}

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
  const expired = [...store.transaction(() => store.consumers.expire(now - CONSUMER_EXPIRY_MS))];
  const { locksDir } = options;
  if (locksDir === undefined) return expired;
  for (const consumer of expired) removeWaiterLock(locksDir, consumer);

  const cutoff = now - WAITERLESS_EXPIRY_MS;
  for (const { consumer } of store.consumers.idleSince(cutoff)) {
    if (waiterLockState(locksDir, consumer) !== "free") continue;
    const gone = store.transaction(() => {
      const record = store.consumers.get(consumer);
      if (record === null || !idle(record, cutoff)) return false;
      store.consumers.unregister(consumer);
      tellLiveness(store, consumer, null);
      writeTurn(store, consumer, null);
      return true;
    });
    if (!gone) continue;
    removeWaiterLock(locksDir, consumer);
    expired.push(consumer);
  }
  return expired;
}

/** `ConsumerRepo.idleSince` for one record. */
function idle(record: ConsumerRecord, cutoff: EpochMs): boolean {
  return record.lastSeenAt < cutoff && (record.lastDeliveredAt ?? 0) < cutoff;
}
