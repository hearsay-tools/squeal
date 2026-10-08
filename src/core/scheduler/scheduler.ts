import { createFsHasher, readObjectFormat } from "../hash/index.js";
import { appendNote } from "../notes.js";
import { statCandidates } from "../revision/index.js";
import { describeFailure } from "../state/index.js";
import type {
  CandidateBatch,
  CheckpointRecord,
  FullSuiteRequest,
  RelativePath,
  Scheduler,
  SchedulerStatus,
  SlowSuiteRequest,
} from "../types/index.js";
import { cancelsBacklog } from "./backlog.js";
import { reconcileBatch } from "./batch.js";
import { baseline, scan } from "./bootstrap.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
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
import { retryRunner } from "./revision.js";
import { RunnerWork } from "./runner-work.js";
import { queueSlowSuite, type SlowRun, SlowTier } from "./slow-tier.js";
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
        fastPending: () => this.#fastPending(),
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
      const applied = await reconcileBatch(context, ledger, batch);
      // Every reconciliation pass looks too: a workspace's `node_modules` is not watched (D5).
      const touched = applied?.revision.changes.some((change) => touchesInstall(change.path));
      if (touched || batch.trigger === "interval") {
        const { missing } = await this.#install.check();
        // The revision stays unrefined, so the next daemon's `scan` reads its paths as edits.
        if (missing !== null) return this.#reinstall(ledger);
      }
      if (applied === null) return;
      this.#slow.preempt();
      // The runner part waits for the runner: a backlog tier yields to an edit (task 001-124).
      for (const { tier } of this.#inFlight.values()) {
        if (tier.cancel && cancelsBacklog(context, ledger, applied.revision, tier)) {
          tier.cancel.abort();
        }
      }
      this.#runnerWork.queueRefine(applied.revision, applied.content);
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

  status(): SchedulerStatus {
    return { revision: this.#ledger?.revision.number ?? 0 };
  }

  idle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
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
   * A slow file (spec 004 D2) is selected only when no tier is in flight, so
   * the slow tier's rules stand as they were with one tier at a time.
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
          if (this.#inFlight.size > 0 && !this.#freeLaneQueued()) {
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
          if (this.#inFlight.size === 0) {
            // Spec 004 D2: no fast file pending; a slow file may run, one per tier.
            const after = await this.#slow.next();
            if (after === "again") continue;
            if (after !== null) {
              this.#fly(after.tier, install.stamp, after);
              continue;
            }
            if (!this.#woken) break;
          }
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
        const report = await executeTier(context, tier);
        const changed = await unstableInputs(context, tier);
        const installMoved = this.#reinstalled || (await this.#install.stamp()) !== installStamp;
        const moved = await this.#lock.run(async () => {
          // Task 001-132: what the run read beyond its closures, hashed under the lock.
          const observed = installMoved
            ? undefined
            : await prepareObserved(context, report, tier.run);
          return recordTier(context, ledger, tier, report, changed, installMoved, observed);
        });
        recorded = true;
        slow?.slot.release();
        // The watcher may not have reported these yet; reconciling twice is harmless.
        if (moved.length > 0) await this.#reconcilePaths(moved);
      } catch (error) {
        this.#stall(error);
        if (!recorded) await this.#requeue(tier);
      } finally {
        slow?.slot.release();
        this.#inFlight.delete(tier.lane);
        this.#notify();
      }
    })();
    this.#inFlight.set(tier.lane, { tier, done });
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

  /** Fast work goes before a slow file (spec 004 D2), a refinement in flight included. */
  #fastPending(): boolean {
    const work = this.#runnerWork;
    return work.size > 0 || work.refining || (this.#ledger?.queue.fastSize ?? 0) > 0;
  }

  /** Puts the files of a tier that never got recorded back into the queue. */
  async #requeue(tier: Tier): Promise<void> {
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
