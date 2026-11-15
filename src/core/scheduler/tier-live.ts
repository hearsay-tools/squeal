import { defaultHostSlots } from "../capacity/pool.js";
import type { EpochMs } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { peekClaim } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import { runnable } from "./focused.js";
import type { Ledger } from "./ledger.js";
import { quietHolds, quietSleepMs } from "./quiet.js";
import type { CutFiles } from "./sharing.js";
import { backlogSlot } from "./slots.js";
import type { PlanAsks, QueueView } from "./tier-plan.js";
import { laneOf } from "./tiers.js";

/** What the caller gives the live view beside the daemon's own state. */
export interface LiveViewOptions {
  /** The lanes no tier may start in, read as each stage starts. */
  readonly busy: () => ReadonlySet<string>;
  readonly cut: CutFiles;
  /** The second group's turn, read as each stage starts (`RunQueue.backlogTurn` by default). */
  readonly turnDue?: () => boolean;
  /** The files a tier beside a running batch's takes; none by default. */
  readonly beside?: () => ((ref: TestFileRef) => boolean) | null;
  /** A started backlog slot is followed by the next selection (the pump). */
  readonly slots?: boolean;
  /** The one clock reading: the step's (row 011-366); the clock's now by default. */
  readonly now?: EpochMs;
}

/**
 * The daemon's queue as a `QueueView` (row 011-346): each read goes to the
 * ledger, the queue, the runner's traits or the quiet state when the plan
 * asks it, as the selection read them before the plan; one clock reading,
 * `now`, which orders the queue too (row 011-347).
 */
export function liveView(
  context: SchedulerContext,
  ledger: Ledger,
  options: LiveViewOptions,
): QueueView {
  const { queue } = ledger;
  const { traits } = context.runner;
  const { runner } = context.policy;
  const now = options.now ?? context.now();
  return {
    now,
    runner: {
      tierSize: runner.tierSize,
      backlogTierSize: runner.backlogTierSize,
      timeoutMs: runner.timeoutMs,
    },
    cut: options.cut,
    slots: options.slots ?? false,
    busy: options.busy,
    turnDue: options.turnDue ?? (() => queue.backlogTurn()),
    beside: options.beside ?? (() => null),
    lane: (ref) => laneOf(context, ref),
    tierWidth: (ref, grant) => traits.tierWidth(ref, grant),
    tierPart: (ref) => traits.tierPart(ref),
    backlogSlot: (ref) => backlogSlot(context, ref),
    file: (ref) => ledger.file(ref),
    inputs: (ref) => context.keys.stabilityPaths(ref),
    runtimePolicy: (ref) => context.keys.runtimeIdentity(ref),
    checkpointIdFor: (ref) => ledger.checkpoints.idFor(ref),
    checkpointActive: () => ledger.checkpoints.active,
    ordered: (turn) => ledger.ordered(turn, now),
    orderedBatches: () => ledger.orderedBatches(now),
    rankAt: (ref, now) => queue.rankAt(ref, now)?.rank ?? null,
    has: (ref) => queue.has(ref),
    isFirstGroup: (ref) => queue.isFirstGroup(ref),
    isForced: (ref) => queue.isForced(ref),
    isRecent: (ref) => queue.isRecent(ref),
    isCatchUp: (ref) => queue.isCatchUp(ref),
    isPromoted: (ref) => queue.isPromoted(ref),
    hasFast: (where) => queue.hasFast(where),
    fastQueued: (where) => ledger.fastQueued(where),
    hasFirstGroup: (where) => queue.hasFirstGroup(where),
    fastSize: () => queue.fastSize,
    batchTurn: () => queue.batchTurn(),
    quietHolds: (ref, lane, tier, now) => quietHolds(context, ledger, ref, lane, tier, now),
    quietWakeMs: (now) => quietSleepMs(context, ledger, now),
    focusedSize: () => queue.focused.size,
    focusRunnable: (entry) => runnable(context, ledger, entry),
  };
}

/**
 * The plan's asks against the daemon (row 011-346): each reads and writes
 * as the selection did before the plan. A lookup's hit is applied there
 * (`Ledger.applyResults`), an unkeyed, blocked or unlisted file leaves the
 * queue, and `endPass` commits; every write lands in the ledger's next
 * commit or the claims' memory, as before.
 */
export function liveAsks(context: SchedulerContext, ledger: Ledger): PlanAsks {
  const { queue, claims } = ledger;
  return {
    beginPass: () => claims.begin(),
    focusWaiting: (now) => queue.focused.waiting(now),
    dropFocus: (entry) => queue.focused.drop(entry),
    peek: (ref) => peekClaim(context, ledger, ref),
    drop: (ref) => {
      queue.remove(ref);
      const file = ledger.file(ref);
      if (file) ledger.touch(file);
    },
    lookup: (file, key) => {
      const { hits, mayWait } = ledger.probe(key);
      if (hits.length === 0) return { mayWait };
      ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(file.ref));
      return "settled";
    },
    held: (key, now) => claims.holds(key, now),
    backlogSize: (queued) => claims.backlogSize(queued),
    // Without a pool a runner runs as wide as its own default: CPUs − 1 for Vitest and node:test.
    offer: (want, kind) => context.capacity?.offer(want, kind) ?? defaultHostSlots(),
    endPass: () => ledger.commit(),
    claimsWaiting: () => claims.waiting,
  };
}
