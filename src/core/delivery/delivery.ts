import { setTimeout as sleep } from "node:timers/promises";
import { baselineFindings, readHeader, toKnownFailure } from "../state/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type Delta,
  type EpochMs,
  type HarnessDelivery,
  type KnownState,
  PAYLOAD_SCHEMA_VERSION,
  type StatusBuilder,
  type Store,
} from "../types/index.js";
import { type DeltaPlan, planDelta, toView } from "./delta.js";

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

  function plan(consumer: Consumer, states: readonly KnownState[], toldAt: EpochMs): DeltaPlan {
    return planDelta({
      view: store.views.list(consumer),
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      revision: store.revisions.latest(consumer.worktreeId)?.number ?? 0,
    });
  }

  /**
   * Reads the delta, writes the view and returns the delta, in one
   * transaction. `heardFrom` records the consumer as seen even when nothing
   * is delivered; a waiter's empty polls do not count.
   */
  function deliver(consumer: Consumer, heardFrom: boolean): Delta | null {
    if (!heardFrom) {
      // Read-only first: an idle waiter takes no write lock until there is something to write.
      if (store.consumers.get(consumer) === null) return null;
      const states = store.knownStates.list(consumer.worktreeId);
      if (isEmpty(plan(consumer, states, now()))) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const delta = plan(consumer, states, at);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const delivered = delta.entries.length > 0;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) return null;
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header: readHeader(store, consumer.worktreeId, states),
        label: delta.entries.every((e) => e.baseline === true) ? "baseline" : "transitions",
        entries: delta.entries,
      };
    });
  }

  return {
    register: async (consumer) =>
      store.transaction(() => {
        const at = now();
        store.consumers.register(consumer, at);
        const states = store.knownStates.list(consumer.worktreeId);
        store.views.writeMany(
          consumer,
          states.map((s) => toView(s, at)),
        );
        const header = readHeader(store, consumer.worktreeId, states);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          consumer,
          header,
          knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
        };
      }),

    unregister: async (consumer) => {
      store.transaction(() => store.consumers.unregister(consumer));
    },

    onToolBoundary: async (consumer) => deliver(consumer, true),

    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) return null;
        const delta = deliver(consumer, false);
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

/**
 * Spec 001 D10: "A consumer that has not been delivered to or heard from for
 * 12 hours is expired". The daemon calls this periodically; returns the
 * consumers removed with their views.
 */
export function expireConsumers(store: Store, now: EpochMs = Date.now()): readonly Consumer[] {
  return store.transaction(() => store.consumers.expire(now - CONSUMER_EXPIRY_MS));
}
