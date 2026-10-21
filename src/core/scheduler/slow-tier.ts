import { setTimeout as delay } from "node:timers/promises";
import type { PoolLease } from "../capacity/index.js";
import {
  acquireSlowSlot,
  clearSlotWaiter,
  loadPerCpu,
  markSlotWaiter,
  othersWaitingForSlot,
  SLOW_LOCK_FILE,
  type SlowSlot,
  slowSlotDir,
  slowSlotHeld,
  waitForCapacity,
} from "../slow/index.js";
import { publishSlowActivity, readSlowActivity } from "../slow/state.js";
import type {
  AbsolutePath,
  CheckKey,
  EpochMs,
  SlowTierActivity,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { perFileLease, WAIT_FOR_CAPACITY } from "./capacity.js";
import { claimOf } from "./claims.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import type { Mutex } from "./mutex.js";
import type { SlowTierOptions } from "./options.js";
import { slowView } from "./slow.js";
import { policyTriggered, quietLeftMs } from "./slow-trigger.js";
import { laneOf, startTier, type Tier, type TierFile } from "./tiers.js";

export { consumersIdle } from "./slow-trigger.js";

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
 * `slow.maxDeferMs` is spent (its note), else `null`; and whether the load is
 * below `slow.maxLoadPerCpu`, as D2's idle width needs.
 */
interface Guarded {
  readonly ranUnderLoad: number | null;
  readonly idle: boolean;
}

/** `next`: a slow run, `"again"` when the pump should plan again, `null` when nothing slow starts now. */
export type SlowNext = SlowRun | "again" | null;

/**
 * Spec 004 D2 to D5: the slow tier of one worktree. Slow files wait in the
 * queue's slow class until no fast work of this daemon is pending or
 * running, its backlog's included (D2 as amended 2026-10-14, task 004-60;
 * an open `run --slow` request waits only for an edit's, `#fastFirst`), and
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
 */
export class SlowTier {
  /** A `run --slow` request is open until no slow file is pending. */
  #requested = false;
  /** What is left of `slow.maxDeferMs` for the pass; `null` between passes. */
  #budgetMs: number | null = null;
  #slotMissedSince: EpochMs | null = null;
  /** This worktree's waiter's mark is in the slot's directory. */
  #marked = false;
  /** The last pass took the slot: its next skips one turn for another worktree's mark. */
  #tookLast = false;
  #slotNoted = false;
  #timer: NodeJS.Timeout | null = null;
  /** When `#timer` fires, so an earlier deadline replaces it. */
  #timerAt = 0;
  /** The load guard's wait in progress; `preempt` aborts it. */
  #wait: AbortController | null = null;
  /** Counts `preempt` calls, so one between selection and the wait is not lost. */
  #preemptions = 0;
  /** What this tier last published, as stored, so `close` clears only its own. */
  #published: string | null = null;

  constructor(
    private readonly host: SlowHost,
    private readonly options: SlowTierOptions = {},
  ) {}

  /** A `run --slow` request is open: the daemon is in use while slow files are pending (row 011-92). */
  get requested(): boolean {
    return this.#requested;
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
    if (this.host.started().ledger.orderedSlow().length > 0) this.host.pump();
  }

  /** Fast work may be coming (a revision, `run --all`): a load guard wait gives way to it. */
  preempt(): void {
    this.#preemptions += 1;
    this.#wait?.abort();
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
   */
  async next(): Promise<SlowNext> {
    const preemptions = this.#preemptions;
    const refs = await this.host.lock.run(() => this.#candidates());
    const { context } = this.host.started();
    const dir = this.options.slotDir ?? slowSlotDir();
    if (refs.length === 0) {
      this.#unmark(dir, context.worktreeId);
      return null;
    }
    if (preemptions !== this.#preemptions) return "again";
    const guard =
      this.#requested || this.#marked
        ? this.#skipGuard(context)
        : await this.#waitForCapacity(context, dir);
    if (guard === "preempted" || preemptions !== this.#preemptions) return "again";
    if (guard === "held") return this.#waitAtSlot(context, dir, false);
    const { maxParallel } = context.policy.slow;
    const load = guard.ranUnderLoad;
    const want = guard.idle && this.host.fastIdle() ? Math.min(maxParallel, refs.length) : 1;
    const yieldTurn = this.#tookLast && othersWaitingForSlot(dir, context.worktreeId);
    const owner = { pid: process.pid, worktreeId: context.worktreeId };
    const slot = yieldTurn ? null : acquireSlowSlot({ dir, owner, permits: maxParallel, want });
    if (slot === null) return this.#waitAtSlot(context, dir, yieldTurn);
    this.#tookLast = true;
    this.#unmark(dir, context.worktreeId);
    this.#slotMissedSince = null;
    this.#slotNoted = false;
    let run: SlowRun | null = null;
    try {
      const selected = await this.host.lock.run(() => this.#select(refs, load, slot));
      // Every file another worktree runs: the pump waits on the claims, not the slot (task 001-205).
      if (selected === "claimed") return null;
      if (selected === WAIT_FOR_CAPACITY) {
        // Another lane's tier has the daemon's free worker and no pool permit is free: its end pumps.
        this.#publish({ kind: "waiting", for: "slot" });
        this.#arm();
        return null;
      }
      if (selected === null) return "again";
      run = { ...selected, slot };
      return run;
    } finally {
      if (run === null) slot.release();
    }
  }

  /**
   * Fast work of this daemon goes first: an edit's always (D2 as amended
   * 2026-10-09), its fast backlog (a baseline, a checkpoint, `run --all`)
   * queued or running unless a `run --slow` request is open (D2 as amended
   * 2026-10-14, task 004-60), so a warm-up's slow files never contend with
   * its fast ones.
   */
  #fastFirst(): boolean {
    return this.host.editPending() || (!this.#requested && !this.host.fastIdle());
  }

  /**
   * Another worktree holds the slot, or this one yields its turn: the files
   * wait at the slot, marked as a waiter, and retry at `SLOW_RECHECK_MS`.
   */
  #waitAtSlot(context: SchedulerContext, dir: AbsolutePath, yielded: boolean): null {
    this.#tookLast = false;
    markSlotWaiter(dir, context.worktreeId);
    this.#marked = true;
    this.#publish({ kind: "waiting", for: "slot" });
    if (!yielded) this.#slotMissed(context, dir);
    this.#arm();
    return null;
  }

  #unmark(dir: AbsolutePath, worktreeId: WorktreeId): void {
    if (!this.#marked) return;
    this.#marked = false;
    clearSlotWaiter(dir, worktreeId);
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
    const queued = ledger.orderedSlow();
    if (queued.length === 0) {
      this.#requested = false;
      this.#budgetMs = null;
      this.#publish(null);
      return [];
    }
    if (this.#fastFirst()) {
      this.#publish({ kind: "waiting", for: "fast" });
      return [];
    }
    const triggered = queued.filter(this.#trigger(context, ledger));
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
    this.#publishUntriggered(context);
    const quiet = quietLeftMs(context);
    this.#arm(quiet === null ? this.#recheckMs() : Math.max(1, quiet));
    return [];
  }

  /**
   * Under the lock: whether a trigger lets a slow file run now. Trigger (a)
   * by `slow.trigger` (`policyTriggered`), an open `run --slow` request, or
   * the file's open `run --all` checkpoint.
   */
  #trigger(context: SchedulerContext, ledger: Ledger): (ref: TestFileRef) => boolean {
    const policy = policyTriggered(context);
    const runAll = ledger.checkpoints.active?.explicit === true;
    return (ref) => policy || this.#requested || (runAll && ledger.checkpoints.idFor(ref) !== null);
  }

  /**
   * What pending slow files no trigger lets run wait for (D8): the agent's
   * pause under `"idle"`; under `"continuous"` only the quiet window, which
   * the line states as pending with no reason.
   */
  #publishUntriggered(context: SchedulerContext): void {
    if (context.policy.slow.trigger === "idle") this.#publish({ kind: "waiting", for: "idle" });
    else this.#publish(null);
  }

  /**
   * An open `run --slow` request skips the load guard (D3 as amended
   * 2026-10-14, task 004-59): no wait, no budget spent, no "ran under load"
   * note. So does a marked waiter, which takes the slot at a handover (task
   * 004-84): its file replaces the one that ran, so the wait would lower no
   * load. The load is still read once, since D2's idle width needs it below
   * `slow.maxLoadPerCpu`: under load the tier runs one file at a time.
   */
  #skipGuard(context: SchedulerContext): Guarded {
    const load = loadPerCpu({
      ...(this.options.load === undefined ? {} : { load: this.options.load }),
      ...(this.options.cpus === undefined ? {} : { cpus: this.options.cpus }),
    });
    return { ranUnderLoad: null, idle: load <= context.policy.slow.maxLoadPerCpu };
  }

  /**
   * The load guard (D3) with the pass's remaining budget; the load it runs
   * under at the bound. `"held"` when every permit of the slot in `dir` is
   * held before or during the wait (task 004-84): the files wait at the slot.
   */
  async #waitForCapacity(
    context: SchedulerContext,
    dir: AbsolutePath,
  ): Promise<Guarded | "preempted" | "held"> {
    const { slow } = context.policy;
    const budget = this.#budgetMs ?? slow.maxDeferMs;
    const wait = new AbortController();
    this.#wait = wait;
    const started = performance.now();
    try {
      const waited = await waitForCapacity({
        maxLoadPerCpu: slow.maxLoadPerCpu,
        maxDeferMs: budget,
        recheckMs: this.#recheckMs(),
        sleep: (ms) => {
          this.#publish({ kind: "waiting", for: "load" });
          return delay(ms, undefined, { signal: wait.signal });
        },
        giveWay: () => slowSlotHeld({ dir, permits: slow.maxParallel }),
        ...(this.options.load === undefined ? {} : { load: this.options.load }),
        ...(this.options.cpus === undefined ? {} : { cpus: this.options.cpus }),
      });
      if (waited.gaveWay === true) return "held";
      return { ranUnderLoad: waited.ranUnderLoad, idle: waited.ranUnderLoad === null };
    } catch (error) {
      if (wait.signal.aborted) return "preempted";
      throw error;
    } finally {
      this.#wait = null;
      this.#budgetMs = Math.max(0, budget - (performance.now() - started));
    }
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
  ): { tier: Tier } | "claimed" | typeof WAIT_FOR_CAPACITY | null {
    // A close since the guard or the slot: a daemon that accepted a stop starts no tier (001-367).
    if (this.host.closed()) return null;
    const { context, ledger } = this.host.started();
    if (this.#fastFirst()) return null;
    const width = this.host.fastIdle() ? slot.permits : 1;
    const triggered = this.#trigger(context, ledger);
    const picked: TierFile[] = [];
    for (const ref of refs) {
      if (picked.length >= width) break;
      if (!ledger.queue.has(ref) || !ledger.queue.isSlow(ref) || !triggered(ref)) continue;
      const tierFile = this.#pick(ref, context, ledger);
      if (tierFile !== null) picked.push(tierFile);
    }
    if (picked.length === 0) return ledger.claims.waiting ? "claimed" : null;
    // 004 D2: every file starts at once, so the tier holds as many as its run starts (review 001-394 B2).
    const atOnce = context.runner.slowWidth?.(picked.map(({ file }) => file.ref));
    if (atOnce !== undefined) picked.splice(Math.max(1, atOnce));
    const perFile = context.policy.slow.maxWorkers;
    const taken = context.capacity?.take(picked.length * perFile, "slow") ?? null;
    if (taken === WAIT_FOR_CAPACITY && !this.#requested) {
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
      started = this.#start(context, ledger, picked, since, lease);
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
    for (const { file } of tier.files) {
      if (ranUnderLoad === null) continue;
      context.note(
        `slow file ${file.ref.path} ran under load ${ranUnderLoad.toFixed(2)} per CPU, above ` +
          `slow.maxLoadPerCpu ${context.policy.slow.maxLoadPerCpu}, once the load guard had ` +
          `waited slow.maxDeferMs for this slow pass (spec 004 D3)`,
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
  ): Tier | null {
    return context.store.transaction(() => {
      const tier = startTier(context, ledger, picked, "slow", lease);
      const first = tier?.files[0];
      if (tier === null || first === undefined) return null;
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
    return { file, key, inputs, checkpointId, forced, waits };
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
    const queued = ledger.orderedSlow();
    if (queued.length === 0) this.#publish(null);
    else if (this.#fastFirst()) this.#publish({ kind: "waiting", for: "fast" });
    else if (queued.some(this.#trigger(context, ledger))) this.#publish(null);
    else this.#publishUntriggered(context);
  }

  /** At close: clears the activity unless another daemon published since (a handover), and the waiter's mark. */
  retire(): void {
    const { context } = this.host.started();
    this.#unmark(this.options.slotDir ?? slowSlotDir(), context.worktreeId);
    const now = readSlowActivity(context.store, context.worktreeId);
    if (now !== null && JSON.stringify(now) === this.#published) this.#publish(null);
  }

  /** Spec 004 D8: what headers and status say the slow tier is doing (`src/core/slow/state.ts`). */
  #publish(activity: SlowTierActivity | null): null {
    const { context } = this.host.started();
    publishSlowActivity(context.store, context.worktreeId, activity);
    this.#published = activity === null ? null : JSON.stringify(activity);
    return null;
  }

  #slotMissed(context: SchedulerContext, dir: string): void {
    const now = context.now();
    this.#slotMissedSince ??= now;
    if (this.#slotNoted || now - this.#slotMissedSince < SLOT_HELD_NOTE_MS) return;
    this.#slotNoted = true;
    context.note(
      `the slow slot ${dir}/${SLOW_LOCK_FILE} has been held by another daemon of this user for ` +
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
 * project the project, as each is a runner of its own that the composite
 * runs after the previous one (spec 003 D7). A slow tier starts all its files
 * at once, so none starts after an edit or a close (review wave 4, B2).
 */
function runnerOf(context: SchedulerContext, ref: TestFileRef): string {
  const lane = laneOf(context, ref);
  const nodeTest = context.policy.nodeTest.some((project) => project.name === ref.project);
  return nodeTest ? `${lane}\0${ref.project}` : lane;
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
  const { isSlow } = slowView(context.policy);
  const open = [...ledger.files.values()].filter(
    (file) =>
      isSlow(file.ref) &&
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
