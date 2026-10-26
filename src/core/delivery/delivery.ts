import { setTimeout as sleep } from "node:timers/promises";
import { withRecorded } from "../retry/index.js";
import { forgetStopWait } from "../slow/stop-wait.js";
import { baselineFindings } from "../state/index.js";
import { splitByValidity } from "../status/checks.js";
import { type ChangeMarker, changeMarker } from "../store/index.js";
import {
  type Consumer,
  type Delta,
  type DeltaEntry,
  type EpochMs,
  type HarnessDelivery,
  type HarnessProcess,
  type KnownState,
  PAYLOAD_SCHEMA_VERSION,
  type RevisionNumber,
  type StatusBuilder,
  type Store,
  type TestFileKeyRecord,
  type TurnState,
  type ViewEntry,
} from "../types/index.js";
import { annotate, withClosureChanges, withDependencies } from "./attribution.js";
import { loaderCounts } from "./closure.js";
import { registerCode, tellCode } from "./code-deliver.js";
import { codeSeenUpTo } from "./code-since.js";
import type { CodeSource } from "./code-source.js";
import { recordVersion } from "./consumer-version.js";
import { oweCounts, payCounts } from "./counts-owed.js";
import { type DeltaPlan, isBaselineEntry, planDelta, restrictPlan, toView } from "./delta.js";
import { carriesEditResult, editNotes, startEdits } from "./edits.js";
import { drop } from "./expiry.js";
import { recordHarness } from "./harness-process.js";
import { heldNow, holdChanges, holdsChange, tellHolds } from "./hold-told.js";
import { markLeaving } from "./leaving.js";
import {
  livenessChange,
  readLiveHeader,
  tellLiveness,
  tellRevision,
  toldLiveness,
  toldOf,
  toldRevision,
  withTold,
} from "./liveness.js";
import { ownEditUnknown } from "./own-edit.js";
import { scannedDaemon, tellRegistered } from "./registered.js";
import { slowTierChanged, tellSlowTier } from "./slow-told.js";
import { toldAtStop } from "./stop-news.js";
import {
  currentKeys,
  endTurn,
  owedScope,
  readTurn,
  startTurn,
  trimmed,
  waitedFor,
  writeTurn,
} from "./turn.js";
import { recordUncoveredTold } from "./uncovered.js";

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
  /** Spec 015 D6: the code store, read while `complexity.enabled` holds. Default: none, so no code part. */
  readonly code?: CodeSource;
}

/**
 * Four polls a second keep an idle wake-up prompt; a poll that finds the
 * store unchanged reads only its change marker (task 001-178).
 */
export const DEFAULT_POLL_INTERVAL_MS = 250;

interface DeliverOptions {
  readonly heardFrom: boolean;
  readonly keep?: ((entry: DeltaEntry) => boolean) | null;
  readonly liveness?: boolean;
  readonly idle?: boolean;
  readonly stop?: boolean;
  /** Deliver only while the worktree's latest revision is this one (`ToolBoundaryOptions`). */
  readonly atRevision?: RevisionNumber;
}

interface Selection {
  readonly only: ((entry: DeltaEntry) => boolean) | null;
  readonly trim: TurnState | null;
}

const sameMarker = (a: ChangeMarker, b: ChangeMarker) => a.others === b.others && a.own === b.own;

/** Row 015-27: the known failures as status counts them, the `current` ones (011 C6). */
const currentFailures = (states: readonly KnownState[]) =>
  splitByValidity(states.filter((s) => s.outcome === "fail")).current.length;

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
    view: readonly ViewEntry[] = store.views.list(consumer),
  ): DeltaPlan {
    const revision = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
    const full = planDelta({
      view,
      states,
      isBaselineFinding: baselineFindings(store, consumer.worktreeId),
      toldAt,
      rootOf: (id) => store.worktrees.get(id)?.root ?? null,
      revision,
      history: (check) => store.transitions.history(consumer.worktreeId, check),
      ownEdit: ownEditUnknown(store, consumer, revision),
    });
    return keep === null ? full : restrictPlan(full, keep);
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
   * UserPromptSubmit, left behind. A liveness or idle delivery also says
   * what the consumer's edits did (`editNotes`, tasks 001-223 and 001-224);
   * the 001-224 line delivers on its own at a liveness delivery that is not
   * a `stop`, and rides on the waiter's news. At a `stop`, a liveness or hold
   * change is told only beside a transition or when one names an action
   * (`toldAtStop`, row 011-215); else the next boundary tells it.
   */
  function deliver(
    consumer: Consumer,
    {
      heardFrom,
      keep = null,
      liveness = false,
      idle = false,
      stop = false,
      atRevision,
    }: DeliverOptions,
  ): Delta | null {
    /** What to deliver, and for the waiter the turn state trimmed of what is no longer owed. */
    const select = (
      states: readonly KnownState[],
      keys: readonly TestFileKeyRecord[] | null = null,
    ): Selection | "silent" => {
      if (!idle) return { only: keep, trim: null };
      const turn = readTurn(store, consumer);
      if (turn.turn !== "idle") return "silent";
      keys ??= store.testFileKeys.list(consumer.worktreeId);
      const current = currentKeys(keys);
      return {
        only: (entry) => waitedFor(turn, entry, current),
        trim: trimmed(turn, states, keys),
      };
    };
    if (!heardFrom) {
      // Read-only first: an idle waiter takes no write lock until there is something to write.
      if (store.consumers.get(consumer) === null) return null;
      const scope = idle ? owedScope(store, consumer) : null;
      if (scope === "nothing") return null;
      const states = scope?.states ?? store.knownStates.list(consumer.worktreeId);
      const selection = select(states, scope?.keys);
      if (selection === "silent") return null;
      const quiet =
        !liveness ||
        (livenessChange(store, consumer, now()) === null &&
          holdsChange(store, consumer, now()) === null);
      const empty = isEmpty(plan(consumer, states, now(), selection.only, scope?.view));
      if (quiet && empty && selection.trim === null) return null;
    }
    return store.transaction(() => {
      if (store.consumers.get(consumer) === null) return null;
      if (!atLatest(consumer, atRevision)) return null;
      if (heardFrom && readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
      // Task 001-416: a consumer heard from after its SubagentStop marked it leaving goes on.
      if (heardFrom && !stop) markLeaving(store, consumer, null);
      const at = now();
      const states = store.knownStates.list(consumer.worktreeId);
      const selection = select(states);
      if (selection === "silent") return null;
      const delta = plan(consumer, states, at, selection.only);
      store.views.removeMany(consumer, delta.removals);
      store.views.writeMany(consumer, delta.writes);
      // Row 011-73 (C8 as amended 2026-10-21): a hold's start and end, told as liveness is.
      // Row 011-215: at Stop both wait for the next boundary, unless beside a transition or an action.
      const { live: changed, held: holds } = toldAtStop(
        { stop, transitions: delta.entries.length > 0 },
        {
          live: liveness ? livenessChange(store, consumer, at) : null,
          held: liveness ? holdsChange(store, consumer, at) : null,
        },
      );
      if (changed !== null) tellLiveness(store, consumer, toldOf(changed));
      if (holds !== null) tellHolds(store, consumer, holds.now);
      const tests = delta.entries.length > 0 || changed !== null || holds !== null;
      // Spec 015 D6, D7: code changes at tool boundaries; a Stop tells them only beside other news.
      // Row 015-27: test news, the waiter's too, counts the functions told over.
      const code = tellCode(options.code, consumer, at, () => codeSeenUpTo(store, consumer), {
        changes: liveness && (tests || !stop),
        toldOver: delta.entries.length > 0,
        // Row 015-65: an `untested` line's loaders, read from the closures only when one is told.
        loaders: () => loaderCounts(store, consumer.worktreeId),
      });
      const news = tests || code !== null;
      const notes = liveness || (idle && news) ? editNotes(store, consumer, states, news) : null;
      const delivered = news || (liveness && !stop && notes?.sawEdit !== undefined);
      if (heardFrom || delivered) store.consumers.touch(consumer, at, delivered);
      if (!delivered) {
        if (selection.trim !== null) writeTurn(store, consumer, selection.trim);
        return null;
      }
      if (idle) startTurn(store, consumer);
      const told = toldRevision(store, consumer);
      const read = readLiveHeader(store, consumer.worktreeId, at, states, told);
      const live = withTold(read, toldLiveness(store, consumer), at);
      tellRevision(store, consumer, live.revision);
      const { entries, header, stillFailing } = annotate(
        store,
        consumer,
        delta.entries,
        live,
        states,
      );
      notes?.tell();
      // Task 001-407: a change delivery shows the slow-tier line when it changed; Stop always does.
      const slowChanged = slowTierChanged(store, consumer, header.slowTier);
      if (stop || slowChanged) tellSlowTier(store, consumer, header.slowTier);
      // Row 011-205: once, the counts a consumer that registered before the listing is owed.
      const countsOwed = payCounts(store, consumer, header);
      const sawEdit =
        notes === null ||
        carriesEditResult(
          notes,
          entries.map((e) => e.check),
          header,
        )
          ? undefined
          : notes.sawEdit;
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
        ...(holds === null ? {} : { holds: holdChanges(holds, header) }),
        ...(slowChanged ? { slowTierChanged: true as const } : {}),
        ...countsOwed,
        ...(sawEdit === undefined ? {} : { sawEdit }),
        ...(notes?.editsSettled === undefined ? {} : { editsSettled: notes.editsSettled }),
        ...(code === null ? {} : { code, knownFailures: currentFailures(states) }),
      };
    });
  }

  /** Per consumer, the store as the waiter's last empty poll left it (task 001-178). */
  const quietAt = new Map<string, ChangeMarker>();

  /**
   * The waiter's poll: `deliver` lists every known state, 15,000 on a large
   * worktree, so a poll that finds the store as the last empty one left it
   * returns `null` without it (task 001-178). The marker is read before
   * `deliver`, so a commit during it is seen next poll; after an empty one
   * that wrote, the marker moved by its own write is kept unless another
   * connection committed meanwhile.
   */
  /** Whether `atRevision`, when given, is the worktree's latest revision. Inside a transaction. */
  function atLatest(consumer: Consumer, atRevision: RevisionNumber | undefined): boolean {
    if (atRevision === undefined) return true;
    return (store.revisions.latest(consumer.worktreeId)?.number ?? 0) === atRevision;
  }

  function deliverIdle(consumer: Consumer): Delta | null {
    const key = JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId]);
    const before = changeMarker(store);
    const last = quietAt.get(key);
    if (before !== null && last !== undefined && sameMarker(before, last)) return null;
    const delta = deliver(consumer, { heardFrom: false, idle: true });
    quietAt.delete(key);
    if (delta !== null || before === null) return delta;
    const after = changeMarker(store);
    quietAt.set(key, after !== null && after.others === before.others ? after : before);
    return null;
  }

  return {
    register: async (consumer, { inTurn = false, atStart = false, startingSince } = {}) =>
      store.transaction(() => {
        const at = now();
        // Review wave 10b, B1: a consumer still registered keeps the revision its changes start at.
        const registered = store.consumers.get(consumer) !== null;
        store.consumers.register(consumer, at);
        // Review wave 13ba, B1: the waiting Stop entry's evidence is this registration's alone.
        forgetStopWait(store, consumer);
        // Review 001-423, B1: a mark left by an earlier SubagentStop is not this registration's.
        markLeaving(store, consumer, null);
        const states = store.knownStates.list(consumer.worktreeId);
        store.views.writeMany(
          consumer,
          states.map((s) => toView(s, at)),
        );
        // Task 001-156: a daemon this hook spawned and that has not heartbeat yet is starting.
        const told = startingSince === undefined ? null : { startingSince };
        const read = readLiveHeader(store, consumer.worktreeId, at, states);
        const live = told === null ? read : withTold(read, told, at);
        const knownFailures = withRecorded(store, consumer.worktreeId, states, live.revision);
        const header = withDependencies(
          store,
          consumer.worktreeId,
          live,
          knownFailures.map((f) => f.check),
        );
        const starting =
          header.daemon?.state === "down" && header.daemon.startingSince !== undefined;
        const daemon = header.daemon === undefined ? null : toldOf(header.daemon);
        tellLiveness(store, consumer, starting ? told : daemon);
        tellRevision(store, consumer, header.revision);
        tellSlowTier(store, consumer, header.slowTier);
        oweCounts(store, consumer, header);
        tellHolds(store, consumer, heldNow(store, consumer.worktreeId, at));
        if (!registered) {
          // Review wave 10d, S2: after tool calls the registration revision may hold their edits.
          const alive = atStart && header.daemon?.state === "alive";
          const resumed = tellRegistered(store, consumer, header.revision, {
            at,
            scanned: scannedDaemon(store, consumer.worktreeId, alive),
          });
          // Tasks 001-223 and 001-224: edits count from here; a resumed session was told once (B2).
          startEdits(store, consumer, header.revision, resumed?.said === true);
          // Review wave 13as, B2: a path told before it left is not told again.
          if (resumed !== null) recordUncoveredTold(store, consumer, resumed.uncovered);
        }
        if (inTurn) startTurn(store, consumer);
        else writeTurn(store, consumer, null);
        recordHarness(store, consumer, options.harnessProcess?.() ?? null);
        recordVersion(store, consumer, options.squealVersion ?? null);
        const code = registerCode(options.code, consumer, at);
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          consumer,
          header,
          // 011-18: a resumed session's failures name the closure paths changed since it started.
          knownFailures: withClosureChanges(store, consumer, knownFailures, header.revision),
          ...(code === undefined ? {} : { code }),
        };
      }),

    unregister: async (consumer) => {
      store.transaction(() => drop(store, consumer, now()));
    },

    onToolBoundary: async (consumer, { stop = false, atRevision } = {}) =>
      deliver(consumer, {
        heardFrom: true,
        liveness: true,
        stop,
        ...(atRevision === undefined ? {} : { atRevision }),
      }),

    peek: async (consumer, { kinds }) => {
      const only = new Set(kinds);
      return deliver(consumer, { heardFrom: true, keep: (e) => only.has(e.kind) });
    },

    startTurn: async (consumer) => deliver(consumer, { heardFrom: true, liveness: true }),

    endTurn: async (consumer, { atRevision, handoff = false } = {}) =>
      store.transaction(() => {
        if (store.consumers.get(consumer) === null) return true;
        if (!atLatest(consumer, atRevision)) return false;
        const states = store.knownStates.list(consumer.worktreeId);
        const at = now();
        endTurn(
          store,
          consumer,
          states,
          plan(consumer, states, at, null).entries,
          handoff ? at : null,
        );
        return true;
      }),

    waitForDelta: async (consumer, { timeoutMs, signal }) => {
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) return null;
        const delta = deliverIdle(consumer);
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
