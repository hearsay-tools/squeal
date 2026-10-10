import { createFsHasher, readObjectFormat } from "../hash/index.js";
import { appendNote } from "../notes.js";
import { statCandidates } from "../revision/index.js";
import { describeFailure } from "../state/index.js";
import {
  type CandidateBatch,
  type CheckpointRecord,
  type EpochMs,
  type FullSuiteRequest,
  isSlowLane,
  type RekeyedTestFile,
  type RelativePath,
  type RevisionNumber,
  type Scheduler,
  type SchedulerStatus,
  type SlowSuiteRequest,
} from "../types/index.js";
import { cancelsBacklog } from "./backlog.js";
import { reconcileBatch } from "./batch.js";
import { baseline, scan } from "./bootstrap.js";
import { claimWake } from "./claims.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import { rekeyEnvironments } from "./environment-growth.js";
import {
  missingInstall,
  REINSTALL_NOTE,
  reconcileWaiting,
  startWaiting,
  stopWaiting,
  touchesInstall,
} from "./install.js";
import { InstallStamps, refreshInstall } from "./install-stamp.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import { prepareObserved } from "./observed.js";
import type { SchedulerOptions } from "./options.js";
import { priorityOf } from "./queue.js";
import { RERUN_CAP } from "./rerun.js";
import { retryRunner } from "./revision.js";
import { RunnerWork } from "./runner-work.js";
import { forgetSlowRuns, queueSlowSuite, type SlowRun, SlowTier } from "./slow-tier.js";
import { withheldForTouch } from "./stability.js";
import {
  abandonFullSuite,
  endTier,
  executeTier,
  laneOf,
  queueFullSuite,
  recordTier,
  selectTier,
  type Tier,
  unstableInputs,
} from "./tiers.js";

/** A tier in flight: its lane is busy until `done`, which never rejects. */
interface InFlight {
  readonly tier: Tier;
  readonly done: Promise<void>;
}

/** Creates the scheduler of one worktree. Call `start` before anything else. */
export function createScheduler(options: SchedulerOptions): Scheduler {
  return new TierScheduler(options);
}

class TierScheduler implements Scheduler {
  readonly #lock = new Mutex();
  readonly #idle: (() => void)[] = [];
  readonly #runnerWork = new RunnerWork({
    lock: this.#lock,
    started: () => this.#started(),
    closed: () => this.#closed,
    pump: () => this.#pump(),
    backgroundError: (subject, error) => this.#backgroundError(subject, error),
  });
  readonly #slow: SlowTier;
  #context: SchedulerContext | null = null;
  #ledger: Ledger | null = null;
  #pumping: Promise<void> | null = null;
  /** The runner work being applied beside the tiers in flight (task 001-140). */
  #draining: Promise<void> | null = null;
  /** The tiers in flight by lane, at most one per lane; a backlog tier carries its `cancel`. */
  readonly #inFlight = new Map<string, InFlight>();
  /** Something the pump waits for happened: a tier ended, runner work drained, a batch or request came. */
  #woken = false;
  #wake: (() => void) | null = null;
  /** The pump was asked for while it ran: once stopped on an error, it starts again. */
  #asked = false;
  #closed = false;
  /** The pump stopped on an error; idle until the next batch or request. */
  #stalled = false;
  /** No runner call until an install (`awaitsInstall`, task 001-100). */
  #awaitingInstall = false;
  /** Paths no runner saw change: edits the baseline queues recent (review wave 11, S2; `scan`). */
  #waitChanges = new Set<RelativePath>();
  /** The install went under this scheduler: it stores nothing more (`#reinstall`, task 001-113). */
  #reinstalled = false;
  #reinstallTold = false;
  readonly #install: InstallStamps;

  constructor(private readonly options: SchedulerOptions) {
    this.#install = new InstallStamps(options.root);
    this.#slow = new SlowTier(
      {
        lock: this.#lock,
        started: () => this.#started(),
        closed: () => this.#closed,
        pump: () => this.#pump(),
        editPending: () => this.#editPending(),
        fastIdle: () => this.#fastIdle(),
      },
      options.slow,
    );
  }

  async start(): Promise<void> {
    await this.#lock.run(async () => {
      if (this.#context) throw new Error("squeal scheduler: started twice");
      const { options } = this;
      const objectFormat = await readObjectFormat(options.root);
      const hasher = options.hasher ?? createFsHasher(options.root, objectFormat);
      const keys = new WorktreeKeys({
        root: options.root,
        worktreeId: options.worktreeId,
        store: options.store,
        hasher,
        objectFormat,
        policy: options.policy,
        squealVersion: options.squealVersion,
        onExtraFiles: (paths) => options.onExtraFiles?.(paths),
        note: (message) => this.#note(message),
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      const context: SchedulerContext = {
        root: options.root,
        worktreeId: options.worktreeId,
        store: options.store,
        runner: options.runner,
        sink: options.sink,
        policy: options.policy,
        reloadPolicy: options.reloadPolicy ?? (() => null),
        keys,
        hasher,
        runsDir: options.runsDir,
        describe: options.describeFailure ?? describeFailure,
        head: options.head,
        now: options.now ?? Date.now,
        note: (message) => this.#note(message),
        rerunCap: options.rerunCap ?? RERUN_CAP,
      };
      const ledger = new Ledger(context);
      // Notes written during the baseline carry its revision.
      this.#ledger = ledger;
      this.#waitChanges = await scan(context, ledger);
      // A daemon killed while waiting left its flag (review wave 11, N5); this one decides again.
      stopWaiting(context);
      const missing = await missingInstall(options.root);
      this.#awaitingInstall = missing !== null;
      if (missing !== null) startWaiting(context, ledger, missing);
      else await this.#baseline(context, ledger);
      this.#context = context;
    });
    this.#pump();
  }

  /**
   * Stores the revision a batch creates and returns: the revision row, stat
   * cache, content re-key, `queued` phases and known states, in one
   * transaction. The runner part is queued and applied by the pump beside
   * the tiers in flight, in batch order (`RunnerWork`, task 001-140).
   *
   * Spec 001 D2: "Creating a revision never waits on the runner: the store
   * work [...] completes within the debounce window even while a tier is
   * running, and the runner-dependent refinement is queued separately,
   * applied in revision order beside the tiers in flight [...], and never
   * holds the revision path." Lessons,
   * defect 1: awaiting `runner.invalidate` here, which the runner serializes
   * behind the running tier, let a revision lag the workspace by a whole
   * tier.
   */
  async handleBatch(batch: CandidateBatch): Promise<void> {
    if (this.#closed || this.#reinstalled) return;
    await this.#lock.run(async () => {
      if (this.#reinstalled) return;
      const { context, ledger } = this.#started();
      if (this.#awaitingInstall) {
        this.#awaitingInstall = await reconcileWaiting(context, ledger, batch, this.#waitChanges);
        if (!this.#awaitingInstall) await this.#baseline(context, ledger);
        return;
      }
      // Another worktree's heal may have left a file held here (review wave 13i, B1).
      if (ledger.confirmHeld()) ledger.commit();
      const { applied, touched } = await reconcileBatch(context, ledger, batch);
      // Every reconciliation pass looks too: a workspace's `node_modules` is not watched (D5).
      const install = applied?.revision.changes.some((change) => touchesInstall(change.path));
      if (install || batch.trigger === "interval") {
        const { missing } = await this.#install.check();
        // The revision stays unrefined, so the next daemon's `scan` reads its paths as edits.
        if (missing !== null) return this.#reinstall(ledger);
      }
      // Task 001-159: the runner hears of a touched-unchanged file before the next tier.
      if (applied === null) {
        if (touched.length > 0) this.#runnerWork.queueTouched(touched);
        return;
      }
      this.#slow.preempt();
      // The runner part waits for the runner: a backlog tier yields to an edit (task 001-124).
      for (const { tier } of this.#inFlight.values()) {
        if (tier.cancel && cancelsBacklog(context, ledger, applied.revision, tier)) {
          tier.cancel.abort();
        }
      }
      this.#runnerWork.queueRefine(applied.revision, applied.content, touched);
    });
    if (this.#reinstalled) this.#tellReinstall();
    else this.#pump();
  }

  /** The baseline, at start or at the install that ends a wait; the wait ends in the store with it. */
  async #baseline(context: SchedulerContext, ledger: Ledger): Promise<void> {
    stopWaiting(context);
    const changed = this.#waitChanges;
    this.#waitChanges = new Set();
    await baseline(context, ledger, changed);
  }

  /**
   * The install went while the scheduler runs (`npm ci` removes
   * `node_modules` first), at the root or in a workspace: it stores nothing
   * more and its daemon exits, so the next hook's fresh daemon waits for the
   * install with no runner open (task 001-113, review wave 11c B1 and B2). The
   * open checkpoint is abandoned, runner parts not applied yet and the queue
   * are dropped, and the tier in flight records nothing. Under the lock;
   * `#tellReinstall` follows outside it.
   */
  #reinstall(ledger: Ledger): void {
    this.#reinstalled = true;
    this.#runnerWork.dropRefinements();
    ledger.queue.clear();
    ledger.checkpoints.finish("abandoned");
  }

  /** Once: `onReinstall`, or the note itself when no daemon listens. */
  #tellReinstall(): void {
    if (this.#reinstallTold) return;
    this.#reinstallTold = true;
    if (this.options.onReinstall) this.options.onReinstall(REINSTALL_NOTE);
    else this.#note(REINSTALL_NOTE);
  }

  /**
   * Queues the checkpoint at once, unless it needs the runner: while a
   * runner failure is outstanding the runner is retried first, and while a
   * revision waits for its runner part the checkpoint follows it.
   */
  async requestFullSuite(request: FullSuiteRequest = {}): Promise<CheckpointRecord> {
    const force = request.force === true;
    // An install the next reconciliation pass would find ends the wait first; still waiting,
    // nothing can be listed or keyed and the checkpoint is abandoned at once (review wave 11, B1).
    if (this.#awaitingInstall) await this.handleBatch({ trigger: "interval", paths: [] });
    this.#slow.preempt();
    const record =
      (await this.#lock.run(() => {
        const { ledger } = this.#started();
        if (this.#awaitingInstall || this.#reinstalled) return abandonFullSuite(ledger);
        if (ledger.broken || this.#runnerWork.size > 0 || this.#runnerWork.refining) return null;
        return queueFullSuite(ledger, force);
      })) ??
      (await this.#runnerWork.afterTier(async () => {
        const { context, ledger } = this.#started();
        if (this.#awaitingInstall || this.#reinstalled) return abandonFullSuite(ledger);
        await retryRunner(context, ledger);
        return queueFullSuite(ledger, force);
      }));
    this.#pump();
    return record;
  }

  /** Spec 004 D2 trigger (b); the slow tier still waits for pending fast work. */
  async requestSlowSuite(): Promise<SlowSuiteRequest> {
    const request = await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      const revision = ledger.revision.number;
      if (this.#awaitingInstall || this.#reinstalled) return { revision, queued: 0 };
      this.#slow.request();
      return { revision, queued: queueSlowSuite(context, ledger) };
    });
    this.#pump();
    return request;
  }

  refreshObserved(): boolean {
    if (this.#closed || this.#reinstalled || this.#awaitingInstall || !this.#context) return false;
    this.#runnerWork.queueObserved();
    this.#pump();
    return true;
  }

  status(): SchedulerStatus {
    return { revision: this.#ledger?.revision.number ?? 0 };
  }

  async refined(): Promise<void> {
    await this.#runnerWork.afterTier(() => Promise.resolve());
  }

  rekeyedSince(
    after: RevisionNumber,
    upTo: RevisionNumber,
    resolvedSince?: EpochMs,
  ): readonly RekeyedTestFile[] {
    const files: RekeyedTestFile[] = [];
    for (const file of this.#ledger?.files.values() ?? []) {
      // The earliest move still owed, and the latest for a window after it (task 001-194).
      for (const revision of new Set([file.keyedAt, file.lastKeyedAt])) {
        if (revision !== null && revision > after && revision <= upTo) {
          files.push({ testFile: file.ref, revision });
        }
      }
    }
    if (resolvedSince === undefined || this.#ledger === null) return files;
    return [...files, ...this.#ledger.discharges.since(resolvedSince, after, upTo)];
  }

  idle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  slowPending(): boolean {
    if (this.#closed || !this.#ledger) return false;
    if ([...this.#inFlight.keys()].some(isSlowLane)) return true;
    return this.#ledger.orderedSlow().length > 0;
  }

  trackedPaths(): Iterable<RelativePath> {
    return this.#context?.keys.cache.paths() ?? [];
  }

  extraFiles(): readonly RelativePath[] {
    return this.#context?.keys.extraFiles() ?? [];
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#slow.close();
    this.#notify();
    await this.#pumping;
    this.#runnerWork.cancel();
    await this.#lock.run(() => {
      this.#ledger?.checkpoints.finish("abandoned");
      // Spec 004 D8: a daemon that is gone runs no slow file (review wave 2, B1).
      if (this.#context) this.#retireSlow();
      // A daemon that is gone waits for nothing; the next one decides again.
      if (this.#awaitingInstall) stopWaiting(this.options);
    });
    for (const resolve of this.#idle.splice(0)) resolve();
  }

  /**
   * Runs tiers until the queue is empty, one at a time per lane (spec 001 D5
   * as amended, task 001-140): a tier holds the files of one lane, and a
   * lane with a tier in flight waits while the others run theirs. Selection
   * and recording hold the lock; the runs and the stability re-stat do not,
   * so batches are reconciled while tiers are in flight. An edit's tier in
   * flight is never cancelled by a new revision; a backlog tier is, and its
   * unfinished files are queued again (task 001-124).
   *
   * The runner work queued meanwhile is applied in arrival order beside the
   * tiers in flight, not after them (`#drain`). A tier is never selected
   * while runner work is pending: its keys would come from a revision the
   * runner has not invalidated yet. A runner that serializes its calls
   * behind its own run (Vitest's adapter) still holds the runner work for
   * as long as its tier runs.
   *
   * A slow tier (spec 004 D2) is selected when no slow tier and no edit's
   * tier is in flight (`#slowMayStart`): a backlog tier may run beside it
   * (D2 as amended 2026-10-09, task 004-34). It runs in a lane of its own
   * (`laneOf`, task 004-18), so an edit's fast tier starts beside it. A fast
   * tier that ends gives way at once from the slow tier's load guard, so the
   * backlog's next tier is not held behind the wait.
   *
   * An error of a tier stops the pump with a note; the tier's files go back
   * to the queue, the tiers still in flight are recorded, and the next batch
   * or request starts the pump again.
   */
  #pump(): void {
    if (this.#closed || !this.#ledger) return;
    if (this.#pumping) {
      this.#asked = true;
      this.#notify();
      return;
    }
    this.#stalled = false;
    this.#asked = false;
    this.#pumping = (async () => {
      try {
        while (!this.#closed && !this.#stalled) {
          this.#woken = false;
          this.#drain();
          if (this.#draining) {
            await this.#nextEvent();
            continue;
          }
          if (this.#awaitingInstall || this.#reinstalled) break;
          // The check before a tier, never during one: only when a free lane has a file to take.
          if (this.#inFlight.size > 0 && !this.#freeLaneQueued() && !this.#slowMayStart()) {
            await this.#nextEvent();
            continue;
          }
          const install = await this.#install.check();
          if (install.missing === null && this.#install.takeChange(install)) {
            // Task 001-109 (review wave-11b S2, agreed with the coordinator).
            await this.#lock.run(() => {
              const { context, ledger } = this.#started();
              return refreshInstall(context, ledger);
            });
            continue;
          }
          const next = await this.#lock.run(() => {
            if (this.#awaitingInstall || this.#reinstalled) return null;
            const { context, ledger } = this.#started();
            if (install.missing !== null) {
              this.#reinstall(ledger);
              return null;
            }
            if (this.#runnerWork.size > 0) return "runner-work" as const;
            return selectTier(context, ledger, new Set(this.#inFlight.keys()));
          });
          if (next === "runner-work") continue;
          if (next !== null) {
            this.#fly(next, install.stamp, null);
            continue;
          }
          if (this.#reinstalled) break;
          if (this.#slowMayStart()) {
            // Spec 004 D2: no edit's fast work pending or running; a slow tier may start.
            const after = await this.#slow.next();
            if (after === "again") continue;
            if (after !== null) {
              this.#fly(after.tier, install.stamp, after);
              continue;
            }
          }
          if (this.#started().ledger.claims.waiting) {
            await this.#claimWake();
            continue;
          }
          if (this.#inFlight.size === 0 && !this.#woken) break;
          await this.#nextEvent();
        }
      } catch (error) {
        this.#stall(error);
      } finally {
        await Promise.all([...this.#inFlight.values()].map((flight) => flight.done));
        await this.#draining;
        this.#pumping = null;
        if (this.#reinstalled) this.#tellReinstall();
        const again = !this.#stalled || this.#asked;
        if (!this.#closed && again && this.#hasWork()) this.#pump();
        else if (this.#isIdle()) for (const resolve of this.#idle.splice(0)) resolve();
      }
    })();
  }

  /**
   * Runs `tier` in its lane and records it under the lock; `slow` is the
   * slow run it belongs to, whose slot it releases. Never rejects: an error
   * stops the pump and puts the tier's files back.
   */
  #fly(tier: Tier, installStamp: string, slow: SlowRun | null): void {
    const { context, ledger } = this.#started();
    const done = (async () => {
      let recorded = false;
      try {
        const ran = await executeTier(context, tier);
        // The completion barrier (task 001-168): a touch since selection withholds the run.
        const inputs = await unstableInputs(context, tier);
        const installMoved = this.#reinstalled || (await this.#install.stamp()) !== installStamp;
        const moved = await this.#lock.run(async () => {
          // Task 003-43: environment files the run loaded beyond the keyed ones re-key first.
          const environment = installMoved
            ? undefined
            : await rekeyEnvironments(context, ran, tier);
          // Task 001-132: what the run read beyond its closures, hashed under the lock.
          const read = installMoved ? undefined : await prepareObserved(context, ran, tier.run);
          const observed =
            environment === undefined || read === undefined ? read : { ...read, environment };
          const touched = [...new Set([...inputs.touched, ...(observed?.touched ?? [])])].sort();
          const report = withheldForTouch(ran, touched);
          // Spec 004 D8: a slow run's artifact and activity go with its results (review wave 2, B1, B2).
          return context.store.transaction(() => {
            const result = recordTier(
              context,
              ledger,
              tier,
              report,
              inputs.changed,
              installMoved,
              observed,
            );
            if (slow === null) forgetSlowRuns(context, ledger, tier);
            else this.#slow.recorded(slow, ledger);
            // The runner hears the touches too, so its next run reads the disk again.
            return [...new Set([...result, ...touched])];
          });
        });
        recorded = true;
        slow?.slot.release();
        // The watcher may not have reported these yet; reconciling twice is harmless.
        if (moved.length > 0) await this.#reconcilePaths(moved);
        if (slow !== null) await this.#releaseIfDrained(tier.lane);
      } catch (error) {
        this.#stall(error);
        if (!recorded) await this.#requeue(tier, slow !== null);
      } finally {
        slow?.slot.release();
        this.#inFlight.delete(tier.lane);
        // A fast tier's lane is free: the slow tier's load guard gives way to its next tier.
        if (slow === null) this.#slow.preempt();
        this.#notify();
      }
    })();
    this.#inFlight.set(tier.lane, { tier, done });
  }

  /**
   * The slow pass of `lane` drained: no file of it is queued, so its runner
   * instance closes (spec 004 D2). While still in flight, so the lane's next
   * tier waits for the close.
   */
  async #releaseIfDrained(lane: string): Promise<void> {
    const { context, ledger } = this.#started();
    const release = context.runner.releaseLane?.bind(context.runner);
    if (release === undefined || this.#closed) return;
    if (ledger.orderedSlow().some((ref) => laneOf(context, ref) === lane)) return;
    await release(lane).catch((error: unknown) =>
      this.#backgroundError(`could not close the runner of lane ${lane}`, error),
    );
  }

  /** A fast file whose lane has no tier in flight is queued. */
  #freeLaneQueued(): boolean {
    const { context, ledger } = this.#started();
    return ledger.queue.hasFast((ref) => !this.#inFlight.has(laneOf(context, ref)));
  }

  /** Applies the queued runner work beside the tiers in flight, unless it is already being applied. */
  #drain(): void {
    if (this.#draining || this.#runnerWork.size === 0) return;
    this.#draining = this.#runnerWork
      .drain()
      .catch((error: unknown) => this.#backgroundError("could not apply runner work", error))
      .finally(() => {
        this.#draining = null;
        this.#notify();
      });
  }

  /**
   * Queued files wait on other worktrees' claims (task 001-205): the pump
   * looks again on `#notify`, when the store moves, or after
   * `CLAIM_RECHECK_MS`, never in a tight loop.
   */
  async #claimWake(): Promise<void> {
    const { context } = this.#started();
    const stop = new AbortController();
    try {
      await Promise.race([this.#nextEvent(), claimWake(context.store, stop.signal)]);
    } finally {
      stop.abort();
    }
  }

  /** Settles when `#notify` is called; at once when it was since the pump's last pass began. */
  #nextEvent(): Promise<void> {
    if (this.#woken) return Promise.resolve();
    return new Promise((resolve) => {
      this.#wake = resolve;
    });
  }

  #notify(): void {
    this.#woken = true;
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  /** A tier's error: the pump stops with a note until the next batch or request. */
  #stall(error: unknown): void {
    this.#stalled = true;
    // Only a batch or request after the error starts the pump again.
    this.#asked = false;
    this.#note(`scheduler stopped running tiers: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    this.#notify();
  }

  /**
   * Never while waiting or reinstalled, so the pump cannot re-arm into a wait
   * (review wave 11c, B1). Slow files are not work here: the slow tier pumps
   * again itself while they wait for a trigger or the slot (spec 004 D2).
   */
  #hasWork(): boolean {
    if (this.#awaitingInstall || this.#reinstalled) return false;
    return this.#runnerWork.size > 0 || (this.#ledger?.queue.fastSize ?? 0) > 0;
  }

  /**
   * An edit's fast work goes before a slow file (spec 004 D2 as amended):
   * runner work, a refinement in flight included, a recent fast file queued,
   * or an edit's tier in flight. A backlog tier carries its `cancel`.
   */
  #editPending(): boolean {
    const work = this.#runnerWork;
    if (work.size > 0 || work.refining || this.#ledger?.queue.hasRecent()) return true;
    return [...this.#inFlight.values()].some(
      ({ tier }) => tier.cancel === null && !isSlowLane(tier.lane),
    );
  }

  /** No fast work pending or running: an idle slow tier may take several files (D2). */
  #fastIdle(): boolean {
    const work = this.#runnerWork;
    if (work.size > 0 || work.refining || (this.#ledger?.queue.fastSize ?? 0) > 0) return false;
    return [...this.#inFlight.keys()].every(isSlowLane);
  }

  /**
   * The pump may ask the slow tier: nothing is in flight (it then also ends
   * a drained pass), or slow files are queued and neither a slow tier nor an
   * edit's tier is in flight.
   */
  #slowMayStart(): boolean {
    if (this.#inFlight.size === 0) return true;
    if ((this.#ledger?.queue.slowSize ?? 0) === 0) return false;
    if ([...this.#inFlight.keys()].some(isSlowLane)) return false;
    return !this.#editPending();
  }

  #retireSlow(): void {
    try {
      this.#slow.retire();
    } catch (error) {
      this.#note(`could not clear the slow tier's activity: ${String(error)}`);
    }
  }

  /** Puts the files of a tier that never got recorded back into the queue; a slow one's activity goes. */
  async #requeue(tier: Tier, slow: boolean): Promise<void> {
    await this.#lock.run(() => {
      const { context, ledger } = this.#started();
      endTier(context, ledger, tier);
      for (const { file } of tier.files) {
        ledger.setRunning(file, null);
        if (ledger.files.get(file.id) === file) {
          ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
        }
      }
      try {
        ledger.commit();
        if (slow) this.#slow.ended();
      } catch (error) {
        this.#note(`could not record the re-queued tier: ${String(error)}`);
      }
    });
  }

  async #reconcilePaths(paths: readonly RelativePath[]): Promise<void> {
    const { context } = this.#started();
    const candidates = await statCandidates(paths, context.hasher);
    await this.handleBatch({ trigger: "watch", paths: candidates });
  }

  #isIdle(): boolean {
    if (this.#closed) return true;
    return this.#pumping === null && (this.#stalled || !this.#hasWork());
  }

  #started(): { context: SchedulerContext; ledger: Ledger } {
    if (!this.#context || !this.#ledger) throw new Error("squeal scheduler: not started");
    return { context: this.#context, ledger: this.#ledger };
  }

  /** An error of work no caller awaits: a note for status, and `onError`. */
  #backgroundError(subject: string, error: unknown): void {
    this.#note(`${subject}: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  /** Persists a note for `squeal status` (D7, review S6). */
  #note(message: string): void {
    const { store, worktreeId, now } = this.options;
    const revision = this.#ledger?.revision.number ?? null;
    try {
      appendNote(store, worktreeId, { at: (now ?? Date.now)(), revision, text: message });
    } catch (error) {
      this.options.onError?.(
        new Error(`squeal scheduler: could not persist a note (${message}): ${String(error)}`),
      );
    }
  }
}
