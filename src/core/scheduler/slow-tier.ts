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
import { publishGroupActivity, readGroupActivity } from "../slow/state.js";
import type { DeferUnderLoad, ResolvedGroup } from "../types/check-groups.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { SLOW_GROUP, TESTS_GROUP } from "../types/scheduler.js";
import type { SlowTierActivity } from "../types/status.js";
import { perFileLease, WAIT_FOR_CAPACITY } from "./capacity.js";
import { claimOf } from "./claims.js";
import { CommitAsks } from "./commit-asks.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import {
  fullWidth,
  poolLaneOf,
  slotDirOf,
  tierKindOf,
  ungated,
  workersPerFile,
} from "./group-limits.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import type { SlowTierOptions } from "./options.js";
import { groupView } from "./slow.js";
import { momentHolds, quietLeftMs } from "./slow-trigger.js";
import { laneOf, startTier, type Tier, type TierFile } from "./tiers.js";

/**
 * Spec 004 D2, D3: the longest a pending slow file waits for the slot, or for
 * an idle consumer under `slow.trigger: "idle"`, before the scheduler looks
 * again. A continuous lane pumps at its quiet window's end instead.
 */
export const SLOW_RECHECK_MS = 15_000;

/** After this long without the slot, a note says another daemon holds it. */
export const SLOT_HELD_NOTE_MS = 60_000;

/** What the slow tier needs from its scheduler. */
export interface SlowHost {
  readonly lock: Mutex;
  started(): { context: SchedulerContext; ledger: Ledger };
  /** `start` has ended: `started` no longer throws. */
  ready(): boolean;
  closed(): boolean;
  /** No tier starts: the daemon stops, or its own runtime went (rows 011-66, 011-106). */
  halted(): boolean;
  /** Either hold holds (011 C9, "Holds"; rows 011-72, 011-74): no tier starts. */
  held(): boolean;
  /**
   * The pump's hold check (row 011-72): the index read again when it moved;
   * a merge hold that ended reconciles what it released, `"released"`.
   */
  holdCheck(): Promise<"held" | "released" | "free">;
  /** Whether the daemon's own runtime went, read again now (row 011-106). */
  runtimeMissing(): Promise<boolean>;
  pump(): void;
  /**
   * An edit's fast work is pending or running: runner work, a recent fast
   * file queued, or an edit's tier in flight. It goes first (D2 as amended
   * 2026-10-09), even before a `run --slow` request.
   */
  editPending(): boolean;
  /**
   * No fast work at all is pending or running: only then does a slow tier
   * start without a `run --slow` request (D2 as amended 2026-10-14, task
   * 004-60), and an idle slow tier may take several files (D2).
   */
  fastIdle(): boolean;
  /**
   * `fastIdle`, and no group of `normal` priority has work pending or
   * running (spec 019 D3): only then may a `low` group's tier take several
   * files. With no `checks` key it is `fastIdle`.
   */
  normalIdle(): boolean;
  /**
   * Group `name`, not `tests`, has a tier in flight or a queued file that
   * holds its followers (`SlowTier.holdsFollowers`): a group that names it
   * in `after` waits (spec 019 D1; row 019-26).
   */
  groupHolds(name: string): boolean;
}

/**
 * A slow tier, selected, with the slot permits it holds until it is recorded
 * (one per file).
 */
export interface SlowRun {
  readonly tier: Tier;
  readonly slot: SlowSlot;
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
 * for its recheck, and the pump asks the other lanes meanwhile.
 */
const DEFERRED = "deferred";

/** `next`: `"flown"` when a slow run started, `"again"` when the pump should plan again, `null` when nothing slow starts now. */
export type SlowNext = "flown" | "again" | null;

/**
 * Spec 004 D2 to D5: the slow tier of one worktree. Slow files wait in the
 * queue's slow class until no fast work of this daemon is pending or
 * running, its backlog's included (D2 as amended 2026-10-14, task 004-60;
 * an open `run --slow` request waits only for an edit's, `#waitsForAfter`), and
 * a trigger holds: the latest revision is `slow.quietMs` old under
 * `slow.trigger: "continuous"` (`quietLeftMs`, D2 as amended 2026-10-18,
 * row 004-80), every registered consumer is idle or none is under `"idle"`
 * (`consumersIdle`), a `run --slow` request is open (`request`), or a
 * `run --all` checkpoint requested the file. Then `next` waits for the load guard with what is left
 * of the pass's `slow.maxDeferMs`, unless a `run --slow` request is open (D3
 * as amended 2026-10-14, task 004-59), takes the per-user slot, and selects a
 * tier, its workers from the per-user pool (001 D11 Capacity, task 001-386): one file, or up to `slow.maxParallel` files of one lane when the
 * machine is idle (no fast work at all and the load below the guard's
 * threshold), holding a permit per file. The pump runs and records it as any
 * tier (D4: the stability check discards and re-queues). A pass ends when no
 * slow file is pending. Waiting for the quiet window arms a timer for its
 * end; waiting for an idle consumer or the slot arms one at
 * `SLOW_RECHECK_MS`; a silent Stop's nudge pumps at once (`nudge`, task
 * 001-281). A fast tier that ends pumps as any tier's end does.
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
  readonly narrow = new CommitAsks();
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
  #timer: NodeJS.Timeout | null = null;
  /** When `#timer` fires, so an earlier deadline replaces it. */
  #timerAt = 0;
  /**
   * While the load guard holds the lane: when its wait began
   * (`performance.now`), and the runner lane its files run in. The next
   * `next` or a `preempt` ends the wait and takes its time off the budget.
   */
  #deferred: { readonly from: number; readonly lane: string } | null = null;
  /** Counts `preempt` calls, so one between selection and the guard is not lost. */
  #preemptions = 0;
  /** What this tier last published, as stored, so `close` clears only its own. */
  #published: string | null = null;
  /** The tier this lane runs, until its record ends it (`endedOnce`). */
  #flying: Tier | null = null;
  #dir: AbsolutePath | null = null;

  constructor(
    private readonly host: SlowHost,
    private readonly options: SlowTierOptions = {},
    /** The group this lane runs (spec 019 D3); default the default `slow` group. */
    readonly group: string = SLOW_GROUP,
  ) {}

  /** The group under the policy in force; `null` once a reload dropped it. */
  #resolved(context: SchedulerContext): ResolvedGroup | null {
    return groupView(context.policy).groups.find((group) => group.name === this.group) ?? null;
  }

  /** The files of the group in the queue, in run order. */
  #queued(ledger: Ledger): TestFileRef[] {
    return ledger.orderedGroup(this.group);
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
   * trigger does not allow; `next` decides as on the timer. Before the
   * scheduler has started it does nothing: the start pumps as it ends.
   */
  nudge(): void {
    if (this.host.closed() || !this.host.ready()) return;
    if (this.#queued(this.host.started().ledger).length > 0) this.host.pump();
  }

  /** Fast work may be coming (a revision, `run --all`): a load guard wait gives way to it. */
  preempt(): void {
    this.#preemptions += 1;
    this.#endDeferral();
  }

  /** The load guard's wait ends: the pass's budget keeps what it did not take. */
  #endDeferral(): void {
    const deferred = this.#deferred;
    if (deferred === null) return;
    this.#deferred = null;
    if (this.#budgetMs === null) return;
    this.#budgetMs = Math.max(0, this.#budgetMs - (performance.now() - deferred.from));
  }

  close(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.preempt();
  }

  /**
   * Called by the pump when no fast tier is left to select. The load guard
   * waits before the slot is taken, so a wait never holds it, and the slot is
   * handed over between files (D2, lessons defect 2): a worktree that misses
   * it leaves a waiter's mark, and one that finds another's mark skips one turn.
   * The guard decides whether the slow lane runs, never which worktree runs
   * it (D3 as amended, task 004-84): it waits only while the slot is free,
   * and a marked waiter takes the slot at a handover without a new wait.
   * The guard's wait holds this lane only (spec 019 D3, review 0.1.396 B1):
   * it publishes the wait, arms a recheck and returns `null`, so the pump
   * asks the other lanes; the recheck's `next` reads the load again with
   * what is left of the budget. `launch` starts the run under the lock, in
   * the block whose check found no hold, so no run starts once a hold began
   * (011 C9; review 0.1.269, B1).
   */
  async next(launch: (run: SlowRun) => void): Promise<SlowNext> {
    this.#endDeferral();
    // A close before this call is seen here, and the count below would miss it (row 011-99).
    if (this.host.closed()) return "again";
    const preemptions = this.#preemptions;
    const refs = await this.host.lock.run(
      () => this.#candidates(),
      `listing the queued files of group ${this.group}`,
    );
    const { context } = this.host.started();
    const dir = this.#slotDir();
    const group = this.#resolved(context);
    if (refs.length === 0 || group === null) {
      this.#unmark(dir, context.worktreeId);
      return null;
    }
    if (preemptions !== this.#preemptions) return "again";
    const guard = this.#guardOf(context, dir, group, refs);
    if (guard === DEFERRED) return null;
    if (!(await this.#mayStart(preemptions))) return "again";
    if (guard === "held") return this.#waitAtSlot(context, dir, false);
    const want = this.#want(context, group, guard, refs.length);
    const slot = this.#takeSlot(context, dir, group, want);
    if (slot === null) return null;
    return this.#launch(refs, guard.ranUnderLoad, slot, group, launch);
  }

  /**
   * The load guard for the lane whose first file is `first`, or none: an
   * open request or a marked waiter skips it, as does a group without
   * `deferUnderLoad` (`#skipGuard`).
   */
  #guardOf(
    context: SchedulerContext,
    dir: AbsolutePath,
    group: ResolvedGroup,
    refs: readonly TestFileRef[],
  ): Guarded | "held" | typeof DEFERRED {
    const defer = group.limits.deferUnderLoad;
    return this.#explicit(refs) || this.#marked || defer === null
      ? this.#skipGuard(defer)
      : this.#guard(dir, group, defer, laneOf(context, refs[0] as TestFileRef));
  }

  /** An open request, or a narrow run's ask for one of `refs` (row 019-49): no guard, no grant. */
  #explicit(refs: readonly TestFileRef[]): boolean {
    if (this.#requested) return true;
    if (this.narrow.size === 0) return false;
    const { ledger } = this.host.started();
    return refs.some((ref) => this.narrow.has(ledger, ref));
  }

  /**
   * After the guard's wait: no preemption since `preemptions` was read, the
   * daemon's runtime still there and no hold begun; else the pump plans again.
   */
  async #mayStart(preemptions: number): Promise<boolean> {
    // A runtime gone since the pump read it starts no tier, and its files take no slot (review 0.1.262, B3).
    if ((await this.host.runtimeMissing()) || preemptions !== this.#preemptions) return false;
    // So is a hold that began meanwhile, a merge's included, which no preemption tells
    // (011 C9; review 0.1.269, B1): the pump plans again and stops on it.
    return (await this.host.holdCheck()) === "free" && preemptions === this.#preemptions;
  }

  /**
   * How many of `count` files the tier may take: a `normal` group's, or a
   * `low` one's on an idle machine with no `normal` work (`normalIdle`), up
   * to its full width; else one (spec 019 D3).
   */
  #want(context: SchedulerContext, group: ResolvedGroup, guard: Guarded, count: number): number {
    const wide = group.limits.priority === "normal" || (guard.idle && this.host.normalIdle());
    return wide ? Math.min(fullWidth(group, context.policy), count) : 1;
  }

  /**
   * The group's slot for `want` files; a group without `maxParallel` takes
   * no shared slot (D3). `null` when the files wait at the slot: another
   * worktree holds it, or this one yields its turn (`#waitAtSlot`).
   */
  #takeSlot(
    context: SchedulerContext,
    dir: AbsolutePath,
    group: ResolvedGroup,
    want: number,
  ): SlowSlot | null {
    const permits = group.limits.maxParallel;
    const yieldTurn =
      permits !== null &&
      (this.#tookLast || this.draining) &&
      othersWaitingForSlot(dir, context.worktreeId, undefined, this.group);
    const owner = { pid: process.pid, worktreeId: context.worktreeId };
    const slot = yieldTurn
      ? null
      : permits === null
        ? noSlot(want)
        : acquireSlowSlot({ dir, owner, permits, want, group: this.group });
    if (slot === null) return this.#waitAtSlot(context, dir, yieldTurn);
    this.#tookLast = true;
    this.#unmark(dir, context.worktreeId);
    this.#slotMissedSince = null;
    this.#slotNoted = false;
    return slot;
  }

  /**
   * Selects the tier under the lock and launches it with `slot`, whose
   * permits go back when no tier flies.
   */
  async #launch(
    refs: readonly TestFileRef[],
    ranUnderLoad: number | null,
    slot: SlowSlot,
    group: ResolvedGroup,
    launch: (run: SlowRun) => void,
  ): Promise<SlowNext> {
    let flown = false;
    try {
      const selected = await this.host.lock.run(() => {
        const picked = this.#select(refs, ranUnderLoad, slot, group);
        if (picked === null || typeof picked !== "object") return picked;
        launch({ ...picked, slot });
        flown = true;
        return "flown" as const;
      }, `selecting a tier of group ${this.group}`);
      // Every file another worktree runs: the pump waits on the claims, not the slot (task 001-205).
      if (selected === "claimed") return null;
      if (selected === WAIT_FOR_CAPACITY) {
        // No pool permit it may take is free: the pump looks again within CAPACITY_RECHECK_MS (011-96).
        // It holds the slow slot, so the wait is the pool's (row 011-291).
        this.#publish({ kind: "waiting", for: "pool" });
        return null;
      }
      return selected === null ? "again" : selected;
    } finally {
      if (!flown) slot.release();
    }
  }

  /**
   * The groups `after` names go first (spec 019 D1): a group's while it has
   * a file queued or a tier in flight. For `tests`, the default `slow`
   * group's: fast work of this daemon, an edit's always (004 D2 as amended
   * 2026-10-09), its fast backlog (a baseline, a checkpoint, `run --all`)
   * queued or running unless a request is open (D2 as amended 2026-10-14,
   * task 004-60), so a warm-up's slow files never contend with its fast
   * ones. During a departure drain only the drain's fast work counts: the
   * paused backlog is not pending (`fastIdle`, row 011-93).
   */
  #waitsForAfter(group: ResolvedGroup): boolean {
    return group.after.some((name) =>
      name === TESTS_GROUP
        ? this.host.editPending() || (!this.#requested && !this.host.fastIdle())
        : this.host.groupHolds(name),
    );
  }

  /**
   * Under the lock: a queued file of this group holds the groups that name
   * it in `after` (spec 019 D1). At `commit` and `manual` (`heldUntilAsked`)
   * only one a trigger lets run does: a commit asked for it at its key, or
   * a request or a checkpoint covers it. Any other runs for no one until a
   * later commit or `squeal run <group>`, so a follower would wait for it
   * forever (row 019-26, review 0.1.398 B2; row 019-47). At any other
   * moment every queued file holds.
   */
  holdsFollowers(): boolean {
    const { context, ledger } = this.host.started();
    const queued = this.#queued(ledger);
    const group = this.#resolved(context);
    if (group === null || !heldUntilAsked(group.at)) return queued.length > 0;
    return queued.some(this.#trigger(context, ledger, group));
  }

  /**
   * Another worktree holds the slot, or this one yields its turn: the files
   * wait at the slot, marked as a waiter unless draining, and retry at
   * `SLOW_RECHECK_MS`.
   */
  #waitAtSlot(context: SchedulerContext, dir: AbsolutePath, yielded: boolean): null {
    this.#tookLast = false;
    if (this.draining) {
      this.#unmark(dir, context.worktreeId);
    } else {
      markSlotWaiter(dir, context.worktreeId, this.group);
      this.#marked = true;
    }
    this.#publish({ kind: "waiting", for: "slot" });
    if (!yielded) this.#slotMissed(context, dir);
    this.#arm();
    return null;
  }

  #unmark(dir: AbsolutePath, worktreeId: WorktreeId): void {
    if (!this.#marked) return;
    this.#marked = false;
    clearSlotWaiter(dir, worktreeId, this.group);
  }

  /**
   * Under the lock: the slow files a trigger lets run now, in order, all of
   * the first one's lane and runner (`runnerOf`); none when none may. A file
   * whose key another worktree runs is none (`claimOf`, task 001-205): the
   * pump waits on the claim without taking the slot, and a result that
   * landed is applied here, so a drain before exit (004-29) ends with it.
   */
  #candidates(): TestFileRef[] {
    const { context, ledger } = this.host.started();
    const queued = this.#queued(ledger);
    const group = this.#resolved(context);
    this.asks.prune(ledger);
    this.narrow.prune(ledger);
    if (queued.length === 0 || group === null) {
      this.#requested = false;
      this.#budgetMs = null;
      this.#publish(null);
      return [];
    }
    if (this.#waitsForAfter(group)) {
      this.#publish({ kind: "waiting", for: "fast" });
      return [];
    }
    const triggered = queued.filter(this.#trigger(context, ledger, group));
    const claims = new Map(triggered.map((ref) => [ref, claimOf(ledger, ref)]));
    const free = triggered.filter((ref) => claims.get(ref) === "free");
    const first = free[0];
    if (first !== undefined) {
      const runner = runnerOf(context, first);
      return free.filter((ref) => runnerOf(context, ref) === runner);
    }
    // A result applied left the queue: what is left decides.
    if ([...claims.values()].includes("settled")) return this.#candidates();
    if ([...claims.values()].includes("waits")) return [];
    this.#publishUntriggered(group);
    const quiet = quietLeftMs(context, group);
    this.#arm(quiet === null ? this.#recheckMs() : Math.max(1, quiet));
    return [];
  }

  /**
   * Under the lock: whether a trigger lets a file of the group run now. Its
   * moment (`momentHolds`; for the default `slow` group trigger (a) by
   * `slow.trigger`), an open request, a commit's ask at the file's key (019
   * D5 step 1), a narrow run's ask at it (019 D6, row 019-49), or the
   * file's open `run --all` checkpoint. Explicit
   * requests ignore moments (spec 019 D1).
   */
  #trigger(
    context: SchedulerContext,
    ledger: Ledger,
    group: ResolvedGroup,
  ): (ref: TestFileRef) => boolean {
    const moment = momentHolds(context, group);
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
    this.#deferred = { from: performance.now(), lane };
    this.#publish({ kind: "waiting", for: "load" });
    this.#arm(Math.min(this.#recheckMs(), budget));
    return DEFERRED;
  }

  /**
   * Under the lock, after the guard and the slot: the tier, of `refs` in
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
    refs: readonly TestFileRef[],
    ranUnderLoad: number | null,
    slot: SlowSlot,
    group: ResolvedGroup,
  ): { tier: Tier } | "claimed" | typeof WAIT_FOR_CAPACITY | null {
    // A close since the guard or the slot: a daemon that accepted a stop starts no tier (001-367),
    // nor one whose runtime another tier's end found gone (011-106), nor one on hold (011 C9).
    if (this.host.halted() || this.host.held()) return null;
    const { context, ledger } = this.host.started();
    if (this.#waitsForAfter(group)) return null;
    const low = group.limits.priority === "low";
    const width = !low || this.host.normalIdle() ? slot.permits : 1;
    const triggered = this.#trigger(context, ledger, group);
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
    const atOnce = context.runner.slowWidth?.(picked.map(({ file }) => file.ref));
    if (atOnce !== undefined) picked.splice(Math.max(1, atOnce));
    const perFile = workersPerFile(group);
    // An edit's tier takes no grant (`ungated`); every other one waits for one, unless requested.
    const taken = ungated(group)
      ? null
      : (context.capacity?.take(picked.length * perFile, poolLaneOf(group)) ?? null);
    if (taken === WAIT_FOR_CAPACITY && !this.#explicit(picked.map(({ file }) => file.ref))) {
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
      started = this.#start(context, ledger, picked, since, lease, group);
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
    return { tier };
  }

  /** `startTier` of `picked`, and the activity naming its files in the same transaction. */
  #start(
    context: SchedulerContext,
    ledger: Ledger,
    picked: readonly TierFile[],
    since: EpochMs,
    lease: PoolLease | undefined,
    group: ResolvedGroup,
  ): Tier | null {
    return context.store.transaction(() => {
      const tier = startTier(context, ledger, picked, tierKindOf(group), lease);
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
   * Under the lock: `ref` as a file of the tier, or `null` when it has no key
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
   * holds, nothing until `next` decides.
   */
  ended(): void {
    const { context, ledger } = this.host.started();
    this.#flying = null;
    this.#endedAt = context.now();
    const queued = this.#queued(ledger);
    const group = this.#resolved(context);
    if (queued.length === 0 || group === null) this.#publish(null);
    else if (this.#waitsForAfter(group)) this.#publish({ kind: "waiting", for: "fast" });
    else if (queued.some(this.#trigger(context, ledger, group))) this.#publish(null);
    else this.#publishUntriggered(group);
  }

  /**
   * `ended` once the tier this lane runs is recorded (`endTier` took it out
   * of `Ledger.tierChanges`); nothing for a lane whose tier still runs or
   * that runs none. A record names no lane, so each lane asks (row 019-10).
   */
  endedOnce(): void {
    const tier = this.#flying;
    if (tier === null || this.host.started().ledger.tierChanges.has(tier.changes)) return;
    this.ended();
  }

  /** At close: clears the activity unless another daemon published since (a handover), and the waiter's mark. */
  retire(): void {
    const { context } = this.host.started();
    this.#unmark(this.#slotDir(), context.worktreeId);
    const now = readGroupActivity(context.store, context.worktreeId, this.group);
    if (now !== null && JSON.stringify(now) === this.#published) this.#publish(null);
  }

  /** Spec 004 D8: what headers and status say the slow tier is doing (`src/core/slow/state.ts`). */
  #publish(activity: SlowTierActivity | null): null {
    const { context } = this.host.started();
    publishGroupActivity(context.store, context.worktreeId, this.group, activity);
    this.#published = activity === null ? null : JSON.stringify(activity);
    return null;
  }

  #slotMissed(context: SchedulerContext, dir: string): void {
    const now = context.now();
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
   * Pumps again after `ms`, once; an armed timer that fires later gives way.
   * The pump re-arms while slow work still waits.
   */
  #arm(ms: number = this.#recheckMs()): void {
    if (this.host.closed()) return;
    const at = performance.now() + ms;
    if (this.#timer !== null) {
      if (this.#timerAt <= at) return;
      clearTimeout(this.#timer);
    }
    this.#timerAt = at;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.host.pump();
    }, ms);
    this.#timer.unref();
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
    release() {
      permits = 0;
    },
  };
}

/** The longest of the files' last known run times, `null` when none is known: a tier lasts its longest file. */
function longest(durations: readonly (number | null)[]): number | null {
  const known = durations.filter((ms): ms is number => ms !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * The keys `tier`'s results may be stored under: each file's run key and,
 * after recording, its current key (a run whose observed growth re-keyed the
 * file stores under that).
 */
export function tierKeys(tier: Tier, ledger: Ledger): CheckKey[] {
  return [...new Set(tier.files.flatMap((tierFile) => fileKeys(tierFile, ledger)))];
}

/** `tierKeys` of one file of a tier. */
function fileKeys({ file, key }: TierFile, ledger: Ledger): CheckKey[] {
  const current = ledger.files.get(file.id)?.key ?? null;
  return current === null || current === key ? [key] : [key, current];
}

/**
 * Spec 004 D2 `run --slow`: every slow file that is not current is queued,
 * as `run --all` queues every file (`queueFullSuite`), under no checkpoint.
 * Returns how many slow files are queued or running for it.
 */
export function queueSlowSuite(context: SchedulerContext, ledger: Ledger): number {
  return queueGroup(context, ledger, SLOW_GROUP);
}

/**
 * Spec 019 D6 `squeal run <group>`: `queueSlowSuite` for every file group
 * `group` owns. Returns how many are queued or running for it.
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
  for (const file of open) file.unknownKey = null;
  const pending = open.filter((file) => file.phase !== null);
  const misses = ledger.settle(
    open.filter((file) => file.phase === null).map((file) => file.ref),
    NOTHING_CHANGED,
  );
  ledger.commit();
  return pending.length + misses.length;
}
