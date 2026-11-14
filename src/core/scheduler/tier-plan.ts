import type { PoolTierKind } from "../capacity/pool.js";
import type { EpochMs, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { CLAIM_RECHECK_MS } from "./claims.js";
import type { FileState } from "./files.js";
import type { FocusEntry } from "./focused-entries.js";
import type { CutFiles } from "./sharing.js";
import { type Pass, pass } from "./tier-pass.js";
import type { Tier, TierFile, TierKind } from "./tiers.js";

/*
 * Row 011-346 (`research/tier-plan.md`, decisions 1 and 3): which tier
 * starts next in the fast lanes, decided apart from starting it. The plan
 * reads the queue through a `QueueView` and asks its questions that write
 * (a saved result, a claim, the pool's offer, the end of a pass) through
 * `PlanAsks`, lazily and in the order `selectTier` asked them; it writes
 * nothing itself. The act step (`startNext`, `tier-start.ts`) takes the
 * grant and starts the candidate; a refusal takes the next candidate.
 */

/** The queue a tier plan is made from (GLOSSARY "Queue view"): read as the plan goes, never copied. */
export interface QueueView {
  /** The plan's one clock reading. */
  readonly now: EpochMs;
  readonly runner: {
    readonly tierSize: number;
    readonly backlogTierSize: number;
    readonly timeoutMs: number | null;
  };
  /** The files a yield cut past their tier's estimate (row 011-112). */
  readonly cut: CutFiles;
  /** Whether a started backlog slot is followed by the next selection in the same turn (the pump). */
  readonly slots: boolean;
  /** The lanes no tier may start in, read as a stage starts (`busyLanes`). */
  busy(): ReadonlySet<string>;
  /** The second group's turn after four first-group tiers, read as a stage starts. */
  turnDue(): boolean;
  /** The files a tier beside a running batch's takes (`besideFiles`), read once the first stage starts nothing. */
  beside(): ((ref: TestFileRef) => boolean) | null;
  lane(ref: TestFileRef): string;
  tierWidth(ref: TestFileRef, grant: number): number;
  tierPart(ref: TestFileRef): string;
  backlogSlot(ref: TestFileRef): number | null;
  file(ref: TestFileRef): FileState | undefined;
  inputs(ref: TestFileRef): readonly RelativePath[];
  runtimePolicy(ref: TestFileRef): string;
  checkpointIdFor(ref: TestFileRef): string | null;
  checkpointActive(): { readonly explicit: boolean } | null;
  ordered(turn: boolean): readonly TestFileRef[];
  orderedBatches(): readonly TestFileRef[];
  rankAt(ref: TestFileRef, now: EpochMs): number | null;
  has(ref: TestFileRef): boolean;
  isFirstGroup(ref: TestFileRef): boolean;
  isForced(ref: TestFileRef): boolean;
  isRecent(ref: TestFileRef): boolean;
  isCatchUp(ref: TestFileRef): boolean;
  isPromoted(ref: TestFileRef): boolean;
  hasFast(where: (ref: TestFileRef) => boolean): boolean;
  /** `Ledger.fastQueued`: while the backlog is paused, a drain's files only. */
  fastQueued(where: (ref: TestFileRef) => boolean): boolean;
  hasFirstGroup(where: (ref: TestFileRef) => boolean): boolean;
  fastSize(): number;
  batchTurn(): boolean;
  quietHolds(
    ref: TestFileRef,
    lane: string,
    tier: { readonly backlog: boolean; readonly turn: boolean },
    now: EpochMs,
  ): boolean;
  /** `quietSleepMs` at `now`: until the earliest wait for quiet that holds a queued file ends. */
  quietWakeMs(now: EpochMs): number | null;
  focusedSize(): number;
  /** The file and key a waiting focused entry runs at, `null` when it should go. */
  focusRunnable(entry: FocusEntry): { file: FileState; key: CheckKey } | null;
}

/** A saved result's lookup: it settled the file, or the file runs and may wait on a claim. */
export type Lookup = "settled" | { readonly mayWait: boolean };

/**
 * The plan's questions whose answers may write, in `selectTier`'s order.
 * The live adapter (`tier-live.ts`) reads and writes exactly as
 * `selectTier` did; a table answers in tests.
 */
export interface PlanAsks {
  /** A pass starts: `Claims.begin`. */
  beginPass(): void;
  /** The waiting focused entries at `now`: prunes those past their deadline. */
  focusWaiting(now: EpochMs): readonly FocusEntry[];
  /** A focused entry that may not run goes. */
  dropFocus(entry: FocusEntry): void;
  /** `peekClaim`: whether a queued file waits on a claim, has a stored result or runs. */
  peek(ref: TestFileRef): "waits" | "stored" | "free";
  /** An unkeyed, blocked or unlisted file leaves the queue. */
  drop(ref: TestFileRef): void;
  /** `Ledger.probe`; a hit is applied and settles the file. */
  lookup(file: FileState, key: CheckKey): Lookup;
  /** `Claims.holds` at `now`. */
  held(key: CheckKey, now: EpochMs): boolean;
  /** `Claims.backlogSize`: the backlog tier's size split with the other daemons. */
  backlogSize(queued: number): number;
  /** The grant the pool would give now; the host's slots without a pool. */
  offer(want: number, kind: PoolTierKind): number;
  /** Where `selectTier` committed: `Ledger.commit`. */
  endPass(): void;
  /** `Claims.waiting`: a file waited on a claim since the last pass began. */
  claimsWaiting(): boolean;
}

/** Why a candidate is in the plan (`research/tier-plan.md`, "The interface"). */
export type CandidateReason =
  | "focused"
  | "turn-after-batch"
  | "batch"
  | "batch-as-edit"
  | "turn"
  | "edit"
  | "backlog"
  | "slot"
  | "beside"
  | "after-claims";

/** The prefix of a candidate's files that fits a grant, and whether it is narrower than an edit's tier. */
export interface AtGrant {
  readonly files: readonly TierFile[];
  readonly narrower: boolean;
}

/** A candidate's ask of the pool (`TierCapacity.take`). */
export interface GrantAsk {
  readonly want: number;
  readonly least: number;
  /** What the pool offered before the pick (`TierCapacity.offer`). */
  readonly offer: number;
  readonly kind: PoolTierKind;
  /** The lane whose wait for CPU a refusal starts (`PoolWaits`, row 011-309). */
  readonly lane: string;
  /** Whether a refusal starts the lane's wait for CPU: not a batch's, which goes on as an edit's. */
  readonly refusalWaits: boolean;
  /** Pure: the files that fit `grant`. */
  atGrant(grant: number): AtGrant;
}

/** A tier the plan would start. */
export interface Candidate {
  readonly reason: CandidateReason;
  readonly kind: TierKind;
  readonly lane: string;
  /** Never empty, of one lane. */
  readonly files: readonly TierFile[];
  /** A focused tier's entries, in the order of `files`; `null` for any other. */
  readonly focus: readonly FocusPick[] | null;
  /** `null`: no grant, as an edit's tier runs. */
  readonly width: GrantAsk | null;
  readonly promoted: boolean;
  readonly beside: boolean;
  /** What the start counts toward: a batch's tier, a tier of the turn's count, or none. */
  readonly counts: "batch" | "tier" | "none";
  /** Counted as a tier that took a file of the second group (`RunQueue.tierSelected`). */
  readonly tookBacklog: boolean;
  /** Its files' wall estimate at its offer or its own width. */
  readonly estimateMs: number;
}

/** A focused entry the plan picked, with the file and key it runs at. */
export interface FocusPick {
  readonly entry: FocusEntry;
  readonly file: FileState;
  readonly key: CheckKey;
}

/** Why nothing starts, first in the pump's order. */
export type IdleReason = "claims" | "quiet" | "pool" | "nothing-queued" | "lane-busy";

/** Nothing starts: why, and when to look again (`null`: on the next event only). */
export interface Idle {
  readonly idle: IdleReason;
  /** The plan's clock reading. */
  readonly at: EpochMs;
  readonly wakeAt: EpochMs | null;
}

/** What the act step did with the last candidate. */
export type Outcome =
  | { readonly started: Tier }
  | { readonly refused: "pool" | "narrower" }
  | { readonly unstarted: readonly TierFile[] };

/**
 * The plan: single use, in one lock turn. `first` is computed when the plan
 * is made; each `after*` continues it from the last candidate's outcome.
 */
export interface TierPlan {
  readonly first: Candidate | Idle;
  /** The pool refused the last candidate, or granted less than an edit's tier of it. */
  afterRefusal(refused?: "pool" | "narrower"): Candidate | Idle;
  /** `startTier` started none of `files`: each settled or waits on a claim. */
  afterUnstarted(files: readonly TierFile[]): Candidate | Idle;
  /** The last candidate started as `tier`: the next backlog slot, or `null` when the plan ends. */
  afterStart(tier: Tier): Candidate | Idle | null;
}

/** Whether `step` is the plan's idle answer. */
export function isIdle(step: Candidate | Idle): step is Idle {
  return "idle" in step;
}

/** The tier plan over `view`, asking `asks` as it goes. */
export function planTiers(view: QueueView, asks: PlanAsks): TierPlan {
  return new Plan(stages(view, asks));
}

class Plan implements TierPlan {
  readonly #steps: Generator<Candidate, Idle | null, Outcome>;
  /** A candidate is out and waits for its outcome: each is answered once. */
  #pending = false;
  readonly first: Candidate | Idle;

  constructor(steps: Generator<Candidate, Idle | null, Outcome>) {
    this.#steps = steps;
    this.first = this.#continued(this.#read(steps.next()));
  }

  afterRefusal(refused: "pool" | "narrower" = "pool"): Candidate | Idle {
    return this.#continued(this.#send({ refused }));
  }

  afterUnstarted(files: readonly TierFile[]): Candidate | Idle {
    return this.#continued(this.#send({ unstarted: files }));
  }

  afterStart(tier: Tier): Candidate | Idle | null {
    return this.#send({ started: tier });
  }

  #send(outcome: Outcome): Candidate | Idle | null {
    if (!this.#pending)
      throw new Error("squeal scheduler: a tier plan was asked with no candidate out");
    return this.#read(this.#steps.next(outcome));
  }

  #read(result: IteratorResult<Candidate, Idle | null>): Candidate | Idle | null {
    this.#pending = result.done !== true;
    return result.value;
  }

  /** Only a start ends the plan without an answer. */
  #continued(step: Candidate | Idle | null): Candidate | Idle {
    if (step === null) throw new Error("squeal scheduler: a tier plan ended without a start");
    return step;
  }
}

/**
 * The stages: the free lanes' selection, then, when it starts nothing, a
 * tier beside a running batch's (row 011-269); after a backlog slot starts,
 * the next selection again, so a lane of slots fills its slots in one turn
 * (task 011-21 slice 2). `null` once a tier started and no slot follows.
 */
function* stages(view: QueueView, asks: PlanAsks): Generator<Candidate, Idle | null, Outcome> {
  let started = yield* pass(view, asks, top(view, "main"));
  if (started === null) {
    const beside = view.beside();
    if (beside !== null) started = yield* pass(view, asks, besidePass(beside));
    if (started === null) return idleOf(view, asks);
  }
  while (view.slots && started.slot === true) {
    started = yield* pass(view, asks, top(view, "slot"));
    if (started === null) return idleOf(view, asks);
  }
  return null;
}

/** A stage's first pass over the free lanes. */
function top(view: QueueView, origin: "main" | "slot"): Pass {
  return {
    busy: view.busy(),
    turnDue: view.turnDue(),
    wide: true,
    rest: false,
    beside: null,
    asEdit: false,
    origin,
  };
}

function besidePass(beside: (ref: TestFileRef) => boolean): Pass {
  return {
    busy: new Set(),
    turnDue: false,
    wide: false,
    rest: false,
    beside,
    asEdit: false,
    origin: "beside",
  };
}

/**
 * Why nothing starts, first in the pump's order (claims, quiet), else
 * whether a busy lane holds work; the act step answers `pool`. The wake time
 * is the reason's own: the pump waits as each reason says.
 */
export function idleOf(view: QueueView, asks: PlanAsks): Idle {
  const at = view.now;
  if (asks.claimsWaiting())
    return { idle: "claims", at, wakeAt: (at + CLAIM_RECHECK_MS) as EpochMs };
  const quiet = view.quietWakeMs(at);
  if (quiet !== null) return { idle: "quiet", at, wakeAt: (at + quiet) as EpochMs };
  return { idle: view.hasFast(() => true) ? "lane-busy" : "nothing-queued", at, wakeAt: null };
}
