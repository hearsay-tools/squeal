import { setTimeout as sleep } from "node:timers/promises";
import { baselineFindings, toKnownFailure } from "../state/index.js";
import {
  type Consumer,
  type Delta,
  type DeltaEntry,
  type EpochMs,
  type HarnessDelivery,
  type HarnessProcess,
  type KnownState,
  PAYLOAD_SCHEMA_VERSION,
  type StatusBuilder,
  type Store,
  type TurnState,
} from "../types/index.js";
import { annotate, withDependencies } from "./attribution.js";
import { recordVersion } from "./consumer-version.js";
import { type DeltaPlan, isBaselineEntry, planDelta, restrictPlan, toView } from "./delta.js";
import { drop } from "./expiry.js";
import { recordHarness } from "./harness-process.js";
import {
  readLiveHeader,
  tellLiveness,
  tellRevision,
  toldLiveness,
  toldRevision,
  worktreeLiveness,
} from "./liveness.js";
import { scannedDaemon, tellRegistered } from "./registered.js";
import {
  currentKeys,
  endTurn,
  readTurn,
  startTurn,
  trimmed,
  waitedFor,
  writeTurn,
} from "./turn.js";

export interface DeliveryOptions {
  /** Builds `status()`; task 001-22 owns the implementation. */
  readonly status: StatusBuilder;
  /** Clock for view and consumer times. Default `Date.now`. */
  readonly now?: () => EpochMs;
  /** How often `waitForDelta` re-reads the store. Default `DEFAULT_POLL_INTERVAL_MS`. */
  readonly pollIntervalMs?: number;
  /**
   * The harness process registering, asked once per registration and
   * recorded with it (lessons, defect 24); `null` records none. Default: none.
   */
  readonly harnessProcess?: () => HarnessProcess | null;
  /**
   * The registering hook's Squeal version, recorded with each registration
   * (task 001-130); `null` records none. Default: none.
   */
  readonly squealVersion?: string | null;
}

/** A store read costs well under a millisecond; four reads a second keep an idle wake-up prompt. */
export const DEFAULT_POLL_INTERVAL_MS = 250;

interface DeliverOptions {
  readonly heardFrom: boolean;
  readonly keep?: ((entry: DeltaEntry) => boolean) | null;
  readonly liveness?: boolean;
  readonly idle?: boolean;
}

interface Selection {
  readonly only: ((entry: DeltaEntry) => boolean) | null;
  readonly trim: TurnState | null;
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
    /** What to deliver, and for the waiter the turn state trimmed of what is no longer owed. */
    const select = (states: readonly KnownState[]): Selection | "silent" => {
      if (!idle) return { only: keep, trim: null };
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle") return "silent";
      const keys = store.testFileKeys.list(consumer.worktreeId);
      const current = currentKeys(keys);
      return {
        only: (entry) => waitedFor(turn, entry, current),
        trim: trimmed(turn, states, keys),
      };
    };
    if (!heardFrom) {
      // Read-only first: an idle waiter takes no write lock until there is something to write.
      if (store.consumers.get(consumer) === null) return null;
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const quiet = !liveness || livenessChange(consumer, now()) === null;
      const empty = isEmpty(plan(consumer, states, now(), selection.only));
      if (quiet && empty && selection.trim === null) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const delta = plan(consumer, states, at, selection.only);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      const changed = liveness ? livenessChange(consumer, at) : null;
      if (changed !== null) tellLiveness(store, consumer, changed.state);
      const delivered = delta.entries.length > 0 || changed !== null;
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) {
        if (selection.trim !== null) writeTurn(store, consumer, selection.trim);
        return null;
      }
      if (idle) startTurn(store, consumer);
      const told = toldRevision(store, consumer);
      const live = readLiveHeader(store, consumer.worktreeId, at, states, told);
      tellRevision(store, consumer, live.revision);
      const { entries, header, stillFailing } = annotate(
        store,
        consumer,
        delta.entries,
        live,
        states,
      );
      const label =
        delta.entries.length > 0 && delta.entries.every(isBaselineEntry)
          ? "baseline"
          : "transitions";
      return {
        schemaVersion: PAYLOAD_SCHEMA_VERSION,
        consumer,
        header,
        label,
        entries,
        stillFailing,
        ...(changed === null ? {} : { liveness: changed }),
      };
    });
  }

  return {
    register: async (consumer, { inTurn = false, atStart = false } = {}) =>
      store.transaction(() => {
        const at = now();
        // Review wave 10b, B1: a consumer still registered keeps the revision its changes start at.
        const registered = store.consumers.get(consumer) !== null;
        store.consumers.register(consumer, at);
        const states = store.knownStates.list(consumer.worktreeId);
        store.views.writeMany(
          consumer,
          states.map((s) => toView(s, at)),
        );
        const live = readLiveHeader(store, consumer.worktreeId, at, states);
        const knownFailures = states.flatMap((s) => toKnownFailure(s, live.revision) ?? []);
        const header = withDependencies(store, consumer.worktreeId, live, knownFailures.length > 0);
        tellLiveness(store, consumer, header.daemon?.state ?? null);
        tellRevision(store, consumer, header.revision);
        if (!registered) {
          // Review wave 10d, S2: after tool calls the registration revision may hold their edits.
          const alive = atStart && header.daemon?.state === "alive";
          tellRegistered(store, consumer, header.revision, {
            at,
            scanned: scannedDaemon(store, consumer.worktreeId, alive),
          });
        }
        if (inTurn) startTurn(store, consumer);
        else writeTurn(store, consumer, null);
        recordHarness(store, consumer, options.harnessProcess?.() ?? null);
        recordVersion(store, consumer, options.squealVersion ?? null);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          consumer,
          header,
          knownFailures,
        };
      }),

    unregister: async (consumer) => {
      store.transaction(() => drop(store, consumer, now()));
    },

    onToolBoundary: async (consumer) => deliver(consumer, { heardFrom: true, liveness: true }),

    peek: async (consumer, { kinds }) => {
      const only = new Set(kinds);
      return deliver(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) });
    },

    startTurn: async (consumer) => deliver(consumer, { heardFrom: true, liveness: true }),

    endTurn: async (consumer, { atRevision } = {}) =>
      store.transaction(() => {
        if (store.consumers.get(consumer) === null) return true;
        const latest = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
        if (atRevision !== undefined && latest !== atRevision) return false;
        const states = store.knownStates.list(consumer.worktreeId);
        endTurn(store, consumer, states, plan(consumer, states, now(), null).entries);
        return true;
      }),

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
