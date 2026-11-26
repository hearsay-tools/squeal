import type { PoolLease } from "../capacity/pool.js";
import { heldUntilAsked } from "../daemon/check-groups.js";
import { loadPerCpu } from "../slow/guard.js";
import { acquireSlowSlot, type SlowSlot, slowSlotDir, slowSlotHeld } from "../slow/slot.js";
import {
  clearSlotWaiter,
  markSlotWaiter,
  othersWaitingForSlot,
  slotFiles,
} from "../slow/slot-files.js";
import { partnerRuns, type SlotFile } from "../slow/slot-holding.js";
import { publishGroupActivity, readGroupActivity } from "../slow/state.js";
import type { DeferUnderLoad, ResolvedGroup } from "../types/check-groups.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { SLOW_GROUP } from "../types/scheduler.js";
import type { SlowTierActivity } from "../types/status.js";
import type { Store } from "../types/store.js";
import type { Admission, LaneAnswer } from "./admission.js";
import { perFileLease, WAIT_FOR_CAPACITY } from "./capacity.js";
import { claimOf } from "./claims.js";
import type { ElapsedMs } from "./clock.js";
import { CommitAsks } from "./commit-asks.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify, clearUnknown } from "./files.js";
import {
  fullWidth,
  poolLaneOf,
  slotDirOf,
  tierKindOf,
  ungated,
  workersPerFile,
} from "./group-limits.js";
import type { Ledger } from "./ledger.js";
import type { SlowTierOptions } from "./options.js";
import { followPartner } from "./slot-follow.js";
import { groupView } from "./slow.js";
import { momentHolds, quietLeftMs } from "./slow-trigger.js";
import { laneOf, startTier, type Tier, type TierFile } from "./tiers.js";
import type { WakeSlot, Wakes } from "./wakes.js";

/**
 * Spec 004 D2, D3: the longest a pending slow file waits for the slot, or for
 * an idle consumer under `slow.trigger: "idle"`, before the scheduler looks
 * again. A continuous lane pumps at its quiet window's end instead.
 */
export const SLOW_RECHECK_MS = 15_000;

/** After this long without the slot, a note says another daemon holds it. */
const SLOT_HELD_NOTE_MS = 60_000;

/**
 * What a lane is made with (row 011-357): its wake in the scheduler's loop
 * (row 011-352), which pumps; the scheduler's clock (row 011-351), for a
 * wait that ends outside a step; and where it publishes its activity. It
 * reads the scheduler's state only through what a call passes it.
 */
export interface LaneLoop {
  readonly wakes: Wakes;
  readonly now: () => EpochMs;
  pump(): void;
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  /** Review 0.1.610 B1: a lane's narrow asks changed, so the scheduler publishes them again. */
  narrowChanged?(): void;
}

/** What a lane reads of its scheduler, passed with each call that needs it. */
export interface LaneState {
  readonly context: SchedulerContext;
  readonly ledger: Ledger;
}

/** A slow run's end, as the lane publishes it: the scheduler's state and its admission now. */
export interface LaneEnd extends LaneState {
  admit(): Admission;
}

/** What a lane decides on in the step's lock turn (row 011-357). */
export interface LaneView extends LaneEnd {
  /** The step's one clock reading. */
  readonly at: EpochMs;
  /** Names the part of the turn the lane is in, for a lock watcher (`Mutex.relabel`). */
  doing(operation: string): void;
}

/**
 * A slow tier, selected, with the slot permits it holds until it is recorded
 * (one per file).
 */
export interface SlowRun {
  readonly tier: Tier;
  readonly slot: SlowSlot;
  /** The lock turn of the admission it starts on (row 011-340). */
  readonly turn: number;
}

/**
 * What the load guard let through: the load a file runs under once
 * `maxDeferMs` is spent (its note), else `null`; and whether the load is
 * below `maxLoadPerCpu`, as D2's idle width needs (`deferUnderLoad`, spec
 * 019 D3; a group without it is never under load).
 */
interface Guarded {
  readonly ranUnderLoad: number | null;
  readonly idle: boolean;
}

/**
 * The load guard holds the lane (spec 019 D3, review 0.1.396 B1): it waits
 * for its recheck, and the step asks the other lanes meanwhile.
 */
const DEFERRED = "deferred";

/**
 * A lane's decision in the step's lock turn (row 011-357): it `started` a
 * run; `again`, the step plans again (the queue moved under its pick); its
 * load guard `deferred` it; or `none` of its files starts now. Only
 * `started` and `again` hold back the lanes after it.
 */
export type LaneDecision = "started" | "again" | typeof DEFERRED | "none";

/**
 * Spec 004 D2 to D5: the slow tier of one worktree. Slow files wait in the
 * queue's slow class until no fast work of this daemon is pending or
 * running, its backlog's included (D2 as amended 2026-10-14, task 004-60;
 * an open `run --slow` request waits only for an edit's, `#waitsForAfter`), and
 * a trigger holds: the latest revision is `slow.quietMs` old under
 * `slow.trigger: "continuous"` (`quietLeftMs`, D2 as amended 2026-10-18,
 * row 004-80), every registered consumer is idle or none is under `"idle"`
 * (`consumersIdle`), a `run --slow` request is open (`request`), or a
 * `run --all` checkpoint requested the file. Then `decide` reads the load
 * guard with what is left of the pass's `slow.maxDeferMs`, unless a `run
 * --slow` request is open (D3 as amended 2026-10-14, task 004-59), takes the
 * per-user slot, and selects a tier, its workers from the per-user pool (001
 * D11 Capacity, task 001-386): one file, or up to `slow.maxParallel` files
 * of one lane when the machine is idle (no fast work at all and the load
 * below the guard's threshold), holding a permit per file. The pump runs and
 * records it as any tier (D4: the stability check discards and re-queues). A
 * pass ends when no slow file is pending. Waiting for the quiet window arms
 * this lane's wake for its end; waiting for the load, an idle consumer or
 * the slot arms it at `SLOW_RECHECK_MS`; a silent Stop's nudge pumps at once
 * (`nudge`, task 001-281). A fast tier that ends pumps as any tier's end does.
 *
 * Spec 019 D3 (row 019-10): one such lane per group other than `tests`,
 * `group` its name; the default `slow` group's is the slow tier above. Each
 * reads its group from the policy in force at every step: its moment
 * (`momentHolds`), the groups it follows (`after`; the default `slow`
 * group's `["tests"]` is "fast work first" above), `deferUnderLoad` (no
 * guard without it), `maxParallel` (no slot without it, and an edit's tier
 * size as its width), `maxWorkers` and `priority` (`group-limits.ts`).
 */
export class SlowTier {
  /** A `run --slow` request is open until no slow file is pending. */
  #requested = false;
  /** Spec 019 D5 step 1 (row 019-22): the files a commit asked a `commit` group's lane to run. */
  readonly asks = new CommitAsks();
  /**
   * Spec 019 D6 "Narrow run" (row 019-49): the files `squeal run <group>
   * <path>...` asked to run, each at its key then. They run whatever the
   * group's moment, past the load guard and without a pool grant, as an
   * open request does; the group's other files keep waiting.
   */
  readonly narrow = new CommitAsks(() => this.loop.narrowChanged?.(), true);
  /** What is left of `slow.maxDeferMs` for the pass; `null` between passes. */
  #budgetMs: number | null = null;
  #slotMissedSince: EpochMs | null = null;
  /** This worktree's waiter's mark is in the slot's directory. */
  #marked = false;
  /**
   * A departure drain (011 C9 and 004 D2 as amended 2026-10-21, row
   * 011-93): it leaves no waiter mark and takes no permit while another
   * worktree's mark is fresh, so a live session's slow files go first.
   */
  draining = false;
  /** The last pass took the slot: its next skips one turn for another worktree's mark. */
  #tookLast = false;
  /** When a slow run last ended (`ended`): a drain's wait counts from it (row 011-163). */
  #endedAt: EpochMs | null = null;
  #slotNoted = false;
  /** Row 011-352: this lane's wake in the scheduler's loop; an earlier deadline replaces a later one. */
  readonly #wake: WakeSlot;
  /**
   * While the load guard holds the lane: when its wait began, on elapsed
   * time (row 011-369: a calendar change spends none of the budget and gives
   * none back), and the runner lane its files run in. The next `decide` or a
   * `preempt` ends the wait and takes its time off the budget.
   */
  #deferred: { readonly from: ElapsedMs; readonly lane: string } | null = null;
  /** What this tier last published, as stored, so `close` clears only its own. */
  #published: string | null = null;
  /** The tier this lane runs, until its record ends it (`endedOnce`). */
  #flying: Tier | null = null;
  #dir: AbsolutePath | null = null;

  constructor(
    private readonly loop: LaneLoop,
    private readonly options: SlowTierOptions = {},
    /** The group this lane runs (spec 019 D3); default the default `slow` group. */
    readonly group: string = SLOW_GROUP,
  ) {
    // The default `slow` lane last; `GroupTiers` ranks the configured ones in the policy's order.
    this.#wake = loop.wakes.slot("slow-lane", () => loop.pump(), {
      rank: group === SLOW_GROUP ? Number.MAX_SAFE_INTEGER : 0,
    });
  }

  /**
   * This lane's place among the configured lanes in a wake pass: its
   * group's index in the policy in force (review 0.1.513 B3). Its wake stays.
   */
  ranked(index: number): void {
    if (this.group !== SLOW_GROUP) this.#wake.rank = index;
  }

  /** The group under the policy in force; `null` once a reload dropped it. */
  #resolved(context: SchedulerContext): ResolvedGroup | null {
    return groupView(context.policy).groups.find((group) => group.name === this.group) ?? null;
  }

  /** The files of the group in the queue, in run order; batch ranks at `at` (row 011-372), else now. */
  #queued(ledger: Ledger, at?: EpochMs): TestFileRef[] {
    return ledger.orderedGroup(this.group, at);
  }

  /**
   * The group's slot directory (`slotDirOf`), read once: under `"repository"`
   * the repository's id is read from its store directory, and the pump asks
   * on every turn.
   */
  #slotDir(): AbsolutePath {
    this.#dir ??= slotDirOf(
      this.group,
      this.options.slotDir ?? slowSlotDir(),
      this.options.slotScope,
    );
    return this.#dir;
  }

  /** A `run --slow` request is open: the daemon is in use while slow files are pending (row 011-92). */
  get requested(): boolean {
    return this.#requested;
  }

  /** When a slow run last ended, recorded, discarded or put back; `null` before the first. */
  get endedAt(): EpochMs | null {
    return this.#endedAt;
  }

  /** Row 011-377: the calendar stepped `ms`: the last end moves with it (`CalendarSteps`). */
  shift(ms: number): void {
    if (this.#endedAt !== null) this.#endedAt = (this.#endedAt + ms) as EpochMs;
  }

  /**
   * The runner lane whose files wait for the load guard now, `null` when
   * none: its instance stays open through the wait (row 011-211).
   */
  get deferring(): string | null {
    return this.#deferred?.lane ?? null;
  }

  /**
   * `run --slow`: the pending slow files run behind fast work, whatever the
   * turns and the load (trigger b; D3 as amended 2026-10-14, task 004-59). A
   * load guard wait in progress gives way, so the pump plans again without it.
   */
  request(): void {
    this.#requested = true;
    this.preempt();
  }

  /**
   * A consumer may have gone idle (task 001-281): with slow files queued the
   * pump plans again now instead of at `SLOW_RECHECK_MS`. It starts nothing a
   * trigger does not allow; `decide` decides as on the timer. The scheduler
   * calls it once started: the start pumps as it ends.
   */
  nudge(ledger: Ledger): void {
    if (this.#queued(ledger).length > 0) this.loop.pump();
  }

  /** Fast work may be coming (a revision, `run --all`), or a hold: a load guard wait gives way to it. */
  preempt(): void {
    this.#endDeferral();
  }

  /** The load guard's wait ends now: the pass's budget keeps what it did not take. */
  #endDeferral(): void {
    const deferred = this.#deferred;
    if (deferred === null) return;
    this.#deferred = null;
    if (this.#budgetMs === null) return;
    this.#budgetMs = Math.max(0, this.#budgetMs - (this.loop.wakes.elapsed() - deferred.from));
  }

  close(): void {
    this.#wake.drop();
    this.preempt();
  }

  /**
   * Row 011-357: the lane's decision in the step's lock turn, on the disk
   * facts the step read just before it: the listing, the load guard, the
   * slot and the pick, in one synchronous piece. The load guard reads before
   * the slot is taken, so a wait never holds it, and the slot is handed over
   * between files (D2, lessons defect 2): a worktree that misses it leaves a
   * waiter's mark, and one that finds another's mark skips one turn. The
   * guard decides whether the slow lane runs, never which worktree runs it
   * (D3 as amended, task 004-84): it defers only while the slot is free, and
   * a marked waiter takes the slot at a handover without a new wait. A
   * deferral holds this lane only (spec 019 D3, review 0.1.396 B1): it
   * publishes the wait, arms this lane's recheck and answers `deferred`, so
   * the step asks the other lanes; the recheck's step reads the load again
   * with what is left of the budget. `fly` starts the run in this turn, so
   * no run starts once a hold began (011 C9; review 0.1.269, B1).
   */
  decide(view: LaneView, fly: (run: SlowRun) => void): LaneDecision {
    this.#endDeferral();
    // The texts of the lane's two lock turns before row 011-357, which `squeal run <group>` prints.
    view.doing(`listing the queued files of group ${this.group}`);
    const refs = this.#candidates(view);
    const dir = this.#slotDir();
    const group = this.#resolved(view.context);
    if (refs.length === 0 || group === null) {
      this.#unmark(dir, view.context.worktreeId);
      return "none";
    }
    view.doing(`selecting a tier of group ${this.group}`);
    const guard = this.#guardOf(view, dir, group, refs);
    if (guard === DEFERRED) return DEFERRED;
    if (guard === "held") return this.#waitAtSlot(view, dir, false);
    const want = this.#want(view, group, guard, refs.length);
    const slot = this.#takeSlot(view, dir, group, want);
    if (slot === null) return "none";
    return this.#launch(view, refs, guard, slot, group, fly);
  }

  /**
   * The load guard for the lane whose first file is `first`, or none: an
   * open request or a marked waiter skips it, as does a group without
   * `deferUnderLoad` (`#skipGuard`).
   */
  #guardOf(
    view: LaneView,
    dir: AbsolutePath,
    group: ResolvedGroup,
    refs: readonly TestFileRef[],
  ): Guarded | "held" | typeof DEFERRED {
    const defer = group.limits.deferUnderLoad;
    return this.#explicit(view.ledger, refs) || this.#marked || defer === null
      ? this.#skipGuard(defer)
      : this.#guard(view, dir, group, defer, laneOf(view.context, refs[0] as TestFileRef));
  }

  /** An open request, or a narrow run's ask for one of `refs` (row 019-49): no guard, no grant. */
  #explicit(ledger: Ledger, refs: readonly TestFileRef[]): boolean {
    if (this.#requested) return true;
    if (this.narrow.size === 0) return false;
    return refs.some((ref) => this.narrow.has(ledger, ref));
  }

  /**
   * How many of `count` files the tier may take: up to its full width when
   * the admission's width is wide, else one (spec 019 D3).
   */
  #want(view: LaneView, group: ResolvedGroup, guard: Guarded, count: number): number {
    const wide = this.#admitted(view, group, guard.idle).width === "wide";
    return wide ? Math.min(fullWidth(group, view.context.policy), count) : 1;
  }

  /**
   * The group's slot for `want` files; a group without `maxParallel` takes
   * no shared slot (D3). `null` when the files wait at the slot: another
   * worktree holds it, or this one yields its turn (`#waitAtSlot`).
   */
  #takeSlot(
    view: LaneView,
    dir: AbsolutePath,
    group: ResolvedGroup,
    want: number,
  ): SlowSlot | null {
    const { worktreeId } = view.context;
    const permits = group.limits.maxParallel;
    const yieldTurn =
      permits !== null &&
      (this.#tookLast || this.draining) &&
      othersWaitingForSlot(dir, worktreeId, undefined, this.group);
    const owner = { pid: process.pid, worktreeId };
    const slot = yieldTurn
      ? null
      : permits === null
        ? noSlot(want)
        : acquireSlowSlot({ dir, owner, permits, want, group: this.group });
    if (slot === null) {
      this.#waitAtSlot(view, dir, yieldTurn);
      return null;
    }
    this.#tookLast = true;
    this.#unmark(dir, worktreeId);
    this.#slotMissedSince = null;
    this.#slotNoted = false;
    return slot;
  }

  /** Selects the tier and starts it with `slot` (`fly`), whose permits go back when no tier flies. */
  #launch(
    view: LaneView,
    refs: readonly TestFileRef[],
    guard: Guarded,
    slot: SlowSlot,
    group: ResolvedGroup,
    fly: (run: SlowRun) => void,
  ): LaneDecision {
    let flown = false;
    try {
      const picked = this.#select(view, refs, guard, slot, group);
      // Every file another worktree runs: the pump waits on the claims, not the slot (task 001-205).
      if (picked === "claimed") return "none";
      if (picked === WAIT_FOR_CAPACITY) {
        // No pool permit it may take is free: the pump looks again within CAPACITY_RECHECK_MS (011-96).
        // It holds the slow slot, so the wait is the pool's (row 011-291).
        this.#publish({ kind: "waiting", for: "pool" });
        return "none";
      }
      if (picked === null) return "again";
      // Rows 023-77, 023-78: what the slot's holder runs, for a waiter's line and its partner.
      slot.holding(picked.tier.files.map(({ file }) => slotFileOf(file)));
      fly({ tier: picked.tier, slot, turn: picked.admitted.turn });
      flown = true;
      return "started";
    } finally {
      if (!flown) slot.release();
    }
  }

  /**
   * The admission of this lane now, with its open request and the load
   * guard's `idle` (row 011-340). Its `waits`: the groups `after` names go
   * first (spec 019 D1); for `tests`, the default `slow` group's, fast work
   * of this daemon, an edit's always (004 D2 as amended 2026-10-09), its
   * fast backlog queued or running unless a request is open (task 004-60),
   * so a warm-up's slow files never contend with its fast ones. During a
   * departure drain only the drain's fast work counts (row 011-93).
   */
  #admitted(view: Pick<LaneView, "admit">, group: ResolvedGroup, idle: boolean): LaneAnswer {
    return view.admit().lane(group.name, { requested: this.#requested, idle });
  }

  /**
   * Under the lock: a queued file of this group holds the groups that name
   * it in `after` (spec 019 D1). At `commit` and `manual` (`heldUntilAsked`)
   * only one a trigger lets run does: a commit asked for it at its key, or
   * a request or a checkpoint covers it. Any other runs for no one until a
   * later commit or `squeal run <group>`, so a follower would wait for it
   * forever (row 019-26, review 0.1.398 B2; row 019-47). At any other
   * moment every queued file holds. `at`: a step's reading (row 011-372).
   */
  holdsFollowers({ context, ledger }: LaneState, at?: EpochMs): boolean {
    const queued = this.#queued(ledger, at);
    const group = this.#resolved(context);
    if (group === null || !heldUntilAsked(group.at)) return queued.length > 0;
    return queued.some(this.#trigger(context, ledger, group, at));
  }

  /**
   * Another worktree holds the slot, or this one yields its turn: the files
   * wait at the slot, marked as a waiter unless draining, and retry at
   * `SLOW_RECHECK_MS`.
   */
  #waitAtSlot({ at, context }: LaneView, dir: AbsolutePath, yielded: boolean): "none" {
    this.#tookLast = false;
    if (this.draining) {
      this.#unmark(dir, context.worktreeId);
    } else {
      markSlotWaiter(dir, context.worktreeId, this.group);
      this.#marked = true;
    }
    // Row 023-83: why, so status names the slot, not "the slot or the pool". Review 0.1.621
    // B2: and where it is, so a reader says "in use" only from the permits as they are then.
    const permits = this.#resolved(context)?.limits.maxParallel ?? null;
    this.#publish({
      kind: "waiting",
      for: "slot",
      slot: yielded ? "turn" : "held",
      ...(permits === null ? {} : { slotAt: { dir, permits } }),
    });
    if (!yielded) this.#slotMissed(context, dir, at);
    this.#arm();
    return "none";
  }

  #unmark(dir: AbsolutePath, worktreeId: WorktreeId): void {
    if (!this.#marked) return;
    this.#marked = false;
    clearSlotWaiter(dir, worktreeId, this.group);
  }

  /**
   * The listing: the slow files a trigger lets run now, in order, all of
   * the first one's lane and runner (`runnerOf`); none when none may. A file
   * whose key another worktree runs is none (`claimOf`, task 001-205): the
   * pump waits on the claim without taking the slot, and a result that
   * landed is applied here, so a drain before exit (004-29) ends with it.
   */
  #candidates(view: LaneView): TestFileRef[] {
    const { at, context, ledger } = view;
    const queued = this.#queued(ledger, at);
    const group = this.#resolved(context);
    this.asks.prune(ledger);
    this.narrow.prune(ledger);
    if (queued.length === 0 || group === null) {
      this.#requested = false;
      this.#budgetMs = null;
      this.#publish(null);
      return [];
    }
    // No width is read here: the load guard has not run.
    if (this.#admitted(view, group, false).waits !== null) {
      this.#publish({ kind: "waiting", for: "fast" });
      return [];
    }
    const triggered = queued.filter(this.#trigger(context, ledger, group, at));
    const claims = new Map(triggered.map((ref) => [ref, claimOf(ledger, ref, at)]));
    const free = this.#follow(
      view,
      group,
      triggered.filter((ref) => claims.get(ref) === "free"),
    );
    const first = free[0];
    if (first !== undefined) {
      const runner = runnerOf(context, first);
      return free.filter((ref) => runnerOf(context, ref) === runner);
    }
    // A result applied left the queue: what is left decides.
    if ([...claims.values()].includes("settled")) return this.#candidates(view);
    if ([...claims.values()].includes("waits")) return [];
    this.#publishUntriggered(group);
    const quiet = quietLeftMs(context, group, at);
    this.#arm(quiet === null ? this.#recheckMs() : Math.max(1, quiet));
    return [];
  }

  /**
   * Row 023-78: `free` with the file another worktree ran first under the
   * group's shared slot first (row 023-83), when a `status --at --run` request queued it
   * here (`followPartner`). A group without `maxParallel` shares no slot.
   */
  #follow(view: LaneView, group: ResolvedGroup, free: TestFileRef[]): readonly TestFileRef[] {
    const permits = group.limits.maxParallel;
    if (permits === null) return free;
    const { at, context, ledger } = view;
    return followPartner(free, ledger, at, () =>
      partnerRuns(this.#slotDir(), this.group, permits, context.worktreeId),
    );
  }

  /**
   * Whether a trigger lets a file of the group run now. Its
   * moment (`momentHolds`; for the default `slow` group trigger (a) by
   * `slow.trigger`), an open request, a commit's ask at the file's key (019
   * D5 step 1), a narrow run's ask at it (019 D6, row 019-49), or the
   * file's open `run --all` checkpoint. Explicit
   * requests ignore moments (spec 019 D1). The moment holds at `at`, a
   * step's reading (row 011-372), else now.
   */
  #trigger(
    context: SchedulerContext,
    ledger: Ledger,
    group: ResolvedGroup,
    at?: EpochMs,
  ): (ref: TestFileRef) => boolean {
    const moment = momentHolds(context, group, at);
    const runAll = ledger.checkpoints.active?.explicit === true;
    return (ref) =>
      moment ||
      this.#requested ||
      this.asks.has(ledger, ref) ||
      this.narrow.has(ledger, ref) ||
      (runAll && ledger.checkpoints.idFor(ref) !== null);
  }

  /**
   * What pending files no trigger lets run wait for (004 D8): the agent's
   * pause at `pause` or `stop` (`"idle"`); at `edit` only the quiet window,
   * which the line states as pending with no reason; at `commit` and
   * `manual` a request, which the group's line names (`group-text.ts`).
   */
  #publishUntriggered(group: ResolvedGroup): void {
    if (group.at === "pause" || group.at === "stop") {
      this.#publish({ kind: "waiting", for: "idle" });
    } else this.#publish(null);
  }

  /**
   * An open `run --slow` request skips the load guard (D3 as amended
   * 2026-10-14, task 004-59): no wait, no budget spent, no "ran under load"
   * note. So does a marked waiter, which takes the slot at a handover (task
   * 004-84): its file replaces the one that ran, so the wait would lower no
   * load. The load is still read once, since D2's idle width needs it below
   * `slow.maxLoadPerCpu`: under load the tier runs one file at a time.
   */
  #skipGuard(defer: DeferUnderLoad | null): Guarded {
    if (defer === null) return { ranUnderLoad: null, idle: true };
    return { ranUnderLoad: null, idle: this.#load() <= defer.maxLoadPerCpu };
  }

  /** The 1-minute load per CPU the guard reads (`loadPerCpu`). */
  #load(): number {
    return loadPerCpu({
      ...(this.options.load === undefined ? {} : { load: this.options.load }),
      ...(this.options.cpus === undefined ? {} : { cpus: this.options.cpus }),
    });
  }

  /**
   * The load guard (D3) with the pass's remaining budget, read once: the
   * load is at or below `maxLoadPerCpu`, or the budget is spent, and the
   * file runs (under the load at the bound). Otherwise `"held"` when every
   * permit of the slot in `dir` is held (task 004-84): the files wait at the
   * slot. Else `DEFERRED`: the lane publishes that it waits for the load and
   * arms its recheck, at most the budget left; its `lane` is `deferring`.
   */
  #guard(
    _view: LaneView,
    dir: AbsolutePath,
    group: ResolvedGroup,
    defer: DeferUnderLoad,
    lane: string,
  ): Guarded | "held" | typeof DEFERRED {
    const budget = this.#budgetMs ?? defer.maxDeferMs;
    this.#budgetMs = budget;
    const load = this.#load();
    if (load <= defer.maxLoadPerCpu) return { ranUnderLoad: null, idle: true };
    if (budget <= 0) return { ranUnderLoad: load, idle: false };
    const permits = group.limits.maxParallel;
    if (permits !== null && slowSlotHeld({ dir, permits, group: this.group })) return "held";
    this.#deferred = { from: this.loop.wakes.elapsed(), lane };
    this.#publish({ kind: "waiting", for: "load" });
    this.#arm(Math.min(this.#recheckMs(), budget));
    return DEFERRED;
  }

  /**
   * After the guard and the slot, in the same turn: the tier, of `refs` in
   * order, as many as `slot` has permits while the machine is still idle,
   * else one, and only as many as one run starts at once
   * (`RunnerAdapter.slowWidth`, review 001-394 B2): the rest stay queued for
   * a later tier. The permits it does not use go. Nothing when an edit's fast
   * work arrived meanwhile. A file is passed over when it left the queue or
   * class, its trigger is gone (a consumer entered a turn during the wait;
   * the file stays queued and the pass keeps its budget), or the store now
   * holds a result that may stand for it (`Ledger.lookup`), here or in the
   * start's transaction (`startTier`; then `null`, so the pump plans again).
   * `"claimed"` when no file runs because other worktrees run their keys
   * (task 001-205). The permits and notes follow the files the
   * tier starts.
   *
   * Before the start the tier takes its workers from the per-user pool, as
   * a backlog tier does (001 D11 Capacity, task 001-386): `slow.maxWorkers`
   * per file, and as many files as its grant holds, at least one. Without a
   * grant it waits (`WAIT_FOR_CAPACITY`), unless a `run --slow` request is
   * open: that runs now, without a grant, as an edit's tier does.
   */
  #select(
    view: LaneView,
    refs: readonly TestFileRef[],
    { ranUnderLoad, idle }: Guarded,
    slot: SlowSlot,
    group: ResolvedGroup,
  ): { tier: Tier; admitted: LaneAnswer } | "claimed" | typeof WAIT_FOR_CAPACITY | null {
    // Read in this lock turn (row 011-340): a daemon that accepted a stop starts no tier
    // (001-367), nor one whose runtime went (011-106), nor one on hold (011 C9), nor one whose
    // `after` groups hold.
    const admitted = this.#admitted(view, group, idle);
    if (admitted.refusal !== null) return null;
    const { context, ledger } = view;
    // The slot's permits carry `#want`'s width already; the width is read again here.
    const width = admitted.width === "wide" ? slot.permits : 1;
    const triggered = this.#trigger(context, ledger, group, view.at);
    const picked: TierFile[] = [];
    for (const ref of refs) {
      if (picked.length >= width) break;
      const mine = ledger.queue.checkGroup(ref) === this.group;
      if (!ledger.queue.has(ref) || !mine || !triggered(ref)) continue;
      const tierFile = this.#pick(ref, context, ledger);
      if (tierFile !== null) picked.push(tierFile);
    }
    if (picked.length === 0) return ledger.claims.waiting ? "claimed" : null;
    // 004 D2: every file starts at once, so the tier holds as many as its run starts (review 001-394 B2).
    picked.splice(context.runner.traits.slowWidth(picked.map(({ file }) => file.ref)));
    const perFile = workersPerFile(group);
    // An edit's tier takes no grant (`ungated`); every other one waits for one, unless requested.
    const taken = ungated(group)
      ? null
      : (context.capacity?.take(picked.length * perFile, poolLaneOf(group)) ?? null);
    if (
      taken === WAIT_FOR_CAPACITY &&
      !this.#explicit(
        ledger,
        picked.map(({ file }) => file.ref),
      )
    ) {
      ledger.commit();
      return WAIT_FOR_CAPACITY;
    }
    const lease =
      taken === WAIT_FOR_CAPACITY || taken === null ? undefined : perFileLease(taken, perFile);
    if (lease !== undefined) picked.splice(Math.max(1, Math.floor(lease.grant / perFile)));
    const since = context.now();
    // The activity names the files in the transaction that marks them running (review wave 2, B1; 004-35).
    let started: Tier | null = null;
    try {
      started = this.#start(context, ledger, picked, since, lease, group, view.at);
    } finally {
      if (started === null) lease?.release();
    }
    const tier = started;
    if (tier === null) {
      // A result recorded since the pick settled one: the queue moved (review wave 13o, B1).
      return picked.some(({ file }) => !ledger.queue.has(file.ref)) ? null : "claimed";
    }
    // One permit per file the tier runs, after the start's lookups and claims (review wave 13o, B2).
    slot.shrinkTo(tier.files.length);
    const bound = group.limits.deferUnderLoad?.maxLoadPerCpu;
    for (const { file } of tier.files) {
      if (ranUnderLoad === null) continue;
      context.note(
        this.group === SLOW_GROUP
          ? `slow file ${file.ref.path} ran under load ${ranUnderLoad.toFixed(2)} per CPU, above ` +
              `slow.maxLoadPerCpu ${bound}, once the load guard had ` +
              `waited slow.maxDeferMs for this slow pass (spec 004 D3)`
          : `file ${file.ref.path} of group "${this.group}" ran under load ` +
              `${ranUnderLoad.toFixed(2)} per CPU, above its deferUnderLoad.maxLoadPerCpu ${bound}, ` +
              "once the load guard had waited its maxDeferMs for this pass (spec 019 D3)",
      );
    }
    return { tier, admitted };
  }

  /** `startTier` of `picked`, and the activity naming its files in the same transaction. */
  #start(
    context: SchedulerContext,
    ledger: Ledger,
    picked: readonly TierFile[],
    since: EpochMs,
    lease: PoolLease | undefined,
    group: ResolvedGroup,
    at: EpochMs,
  ): Tier | null {
    return context.store.transaction(() => {
      const tier = startTier(context, ledger, picked, tierKindOf(group), lease, { at });
      const first = tier?.files[0];
      if (tier === null || first === undefined) return null;
      this.#flying = tier;
      const lastDurationMs = longest(tier.files.map(({ file }) => file.durationMs));
      const paths = tier.files.map(({ file }) => file.ref.path);
      this.#publish({
        kind: "running",
        path: first.file.ref.path,
        ...(paths.length > 1 ? { paths } : {}),
        since,
        lastDurationMs,
      });
      return tier;
    });
  }

  /**
   * `ref` as a file of the tier, or `null` when it has no key
   * or is blocked (it leaves the queue), when another worktree's result
   * stands for it (applied), or when another worktree runs its key and its
   * result could stand for it (it stays queued, task 001-205).
   */
  #pick(ref: TestFileRef, context: SchedulerContext, ledger: Ledger): TierFile | null {
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    const checkpointId = ledger.checkpoints.idFor(ref);
    const forced = ledger.queue.isForced(ref);
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      ledger.commit();
      return null;
    }
    const { hits, mayWait } = forced ? { hits: [], mayWait: false } : ledger.probe(key);
    if (hits.length > 0) {
      ledger.applyResults(file, key, hits, checkpointId);
      ledger.commit();
      return null;
    }
    const waits = mayWait && !ledger.queue.isRecent(ref);
    if (waits && ledger.claims.holds(key)) return null;
    const inputs = context.keys.stabilityPaths(ref);
    const runtimePolicy = context.keys.runtimeIdentity(ref);
    return { file, key, inputs, runtimePolicy, checkpointId, forced, waits };
  }

  /**
   * Under the lock, as a slow run ends, recorded, discarded or put back: its
   * "running" activity goes in favour of what the remaining slow files wait
   * for, without starting one (review wave 2, B1). An edit's fast work in
   * flight or pending, or the agent not pausing; when a trigger already
   * holds, nothing until `decide` decides. `admit` is the admission now.
   */
  ended({ context, ledger, admit }: LaneEnd): void {
    this.#flying = null;
    this.#endedAt = context.now();
    const queued = this.#queued(ledger);
    const group = this.#resolved(context);
    if (queued.length === 0 || group === null) this.#publish(null);
    else if (this.#admitted({ admit }, group, false).waits !== null)
      this.#publish({ kind: "waiting", for: "fast" });
    else if (queued.some(this.#trigger(context, ledger, group))) this.#publish(null);
    else this.#publishUntriggered(group);
  }

  /**
   * `ended` once the tier this lane runs is recorded (`endTier` took it out
   * of `Ledger.tierChanges`); nothing for a lane whose tier still runs or
   * that runs none. A record names no lane, so each lane asks (row 019-10).
   */
  endedOnce(end: LaneEnd): void {
    const tier = this.#flying;
    if (tier === null || end.ledger.tierChanges.has(tier.changes)) return;
    this.ended(end);
  }

  /** At close: clears the activity unless another daemon published since (a handover), and the waiter's mark. */
  retire(): void {
    const { store, worktreeId } = this.loop;
    this.narrow.clear();
    this.#unmark(this.#slotDir(), worktreeId);
    const now = readGroupActivity(store, worktreeId, this.group);
    if (now !== null && JSON.stringify(now) === this.#published) this.#publish(null);
  }

  /** Spec 004 D8: what headers and status say the slow tier is doing (`src/core/slow/state.ts`). */
  #publish(activity: SlowTierActivity | null): null {
    publishGroupActivity(this.loop.store, this.loop.worktreeId, this.group, activity);
    this.#published = activity === null ? null : JSON.stringify(activity);
    return null;
  }

  #slotMissed(context: SchedulerContext, dir: string, now: EpochMs): void {
    this.#slotMissedSince ??= now;
    if (this.#slotNoted || now - this.#slotMissedSince < SLOT_HELD_NOTE_MS) return;
    this.#slotNoted = true;
    // The words are 019-16's; the file is the group's first permit (row 019-11).
    const first = slotFiles(this.group).permit(0);
    context.note(
      `the slow slot ${dir}/${first} has been held by another daemon of this user for ` +
        "over a minute; this worktree's slow files wait for it (spec 004 D2)",
    );
  }

  /**
   * Pumps again `ms` of elapsed time from now, once; a wake stated later
   * gives way (row 011-369: from the step's arm, not its calendar reading).
   * The step re-arms while slow work still waits; a closed lane's wake is dropped.
   */
  #arm(ms: number = this.#recheckMs()): void {
    this.#wake.within(ms);
  }

  #recheckMs(): number {
    return Math.min(this.options.recheckMs ?? SLOW_RECHECK_MS, SLOW_RECHECK_MS);
  }
}

/**
 * What runs `ref`: its lane, since a tier runs in one, and for a node:test
 * or pytest project the project, as each is a runner of its own that the
 * composite runs after the previous one (spec 003 D7, 007 D1). A slow tier
 * starts all its files at once, so none starts after an edit or a close
 * (review wave 4, B2).
 */
function runnerOf(context: SchedulerContext, ref: TestFileRef): string {
  const lane = laneOf(context, ref);
  const { nodeTest, pytest } = context.policy;
  const own = [...nodeTest, ...pytest].some((project) => project.name === ref.project);
  return own ? `${lane}\0${ref.project}` : lane;
}

/** The slot of a group without `maxParallel` (spec 019 D3): `want` permits nothing holds. */
function noSlot(want: number): SlowSlot {
  let permits = want;
  return {
    get permits() {
      return permits;
    },
    shrinkTo(count) {
      permits = Math.min(permits, Math.max(1, count));
    },
    holding() {},
    release() {
      permits = 0;
    },
  };
}

/** A tier's file as the slot's record names it (`SlowSlot.holding`). */
function slotFileOf(file: TierFile["file"]): SlotFile {
  return { project: file.ref.project, path: file.ref.path, durationMs: file.durationMs };
}

/** The longest of the files' last known run times, `null` when none is known: a tier lasts its longest file. */
function longest(durations: readonly (number | null)[]): number | null {
  const known = durations.filter((ms): ms is number => ms !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * Spec 019 D6 `squeal run <group>`: every file of the group `group` that is
 * not current is queued, as `run --all` queues every file
 * (`queueFullSuite`), under no checkpoint. Returns how many are queued or
 * running for it.
 */
export function queueGroup(context: SchedulerContext, ledger: Ledger, group: string): number {
  const { of } = groupView(context.policy);
  const open = [...ledger.files.values()].filter(
    (file) =>
      of(file.ref).name === group &&
      file.key !== null &&
      file.blocked === null &&
      classify(file) !== "current",
  );
  for (const file of open) clearUnknown(file);
  const pending = open.filter((file) => file.phase !== null);
  const misses = ledger.settle(
    open.filter((file) => file.phase === null).map((file) => file.ref),
    NOTHING_CHANGED,
  );
  ledger.commit();
  return pending.length + misses.length;
}
