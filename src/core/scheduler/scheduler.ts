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
} from "../types/index.js";
import { reconcileBatch } from "./batch.js";
import { baseline, scan } from "./bootstrap.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import {
  type MissingInstall,
  missingInstall,
  reconcileWaiting,
  startWaiting,
  stopWaiting,
  touchesInstall,
} from "./install.js";
import { InstallStamps } from "./install-stamp.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import type { SchedulerOptions } from "./options.js";
import { priorityOf } from "./queue.js";
import { retryRunner } from "./revision.js";
import { RunnerWork } from "./runner-work.js";
import {
  abandonFullSuite,
  executeTier,
  queueFullSuite,
  recordTier,
  selectTier,
  type Tier,
  unstableInputs,
} from "./tiers.js";

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
  #context: SchedulerContext | null = null;
  #ledger: Ledger | null = null;
  #pumping: Promise<void> | null = null;
  #closed = false;
  /** The pump stopped on an error; idle until the next batch or request. */
  #stalled = false;
  /** No runner call until an install (`awaitsInstall`, task 001-100). */
  #awaitingInstall = false;
  /** Paths revisions changed during the wait: edits the baseline queues recent (review wave 11, S2). */
  #waitChanges = new Set<RelativePath>();
  readonly #install: InstallStamps;

  constructor(private readonly options: SchedulerOptions) {
    this.#install = new InstallStamps(options.root);
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
      await scan(context, ledger);
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
   * transaction. The runner part is queued and applied by the pump after the
   * tier in flight, in batch order (`RunnerWork`).
   *
   * Spec 001 D2: "Creating a revision never waits on the runner: the store
   * work [...] completes within the debounce window even while a tier is
   * running, and the runner-dependent refinement is queued behind the tier
   * separately and applied without holding the revision path." Lessons,
   * defect 1: awaiting `runner.invalidate` here, which the runner serializes
   * behind the running tier, let a revision lag the workspace by a whole
   * tier.
   */
  async handleBatch(batch: CandidateBatch): Promise<void> {
    if (this.#closed) return;
    await this.#lock.run(async () => {
      const { context, ledger } = this.#started();
      if (this.#awaitingInstall) {
        this.#awaitingInstall = await reconcileWaiting(context, ledger, batch, this.#waitChanges);
        if (!this.#awaitingInstall) await this.#baseline(context, ledger);
        return;
      }
      const applied = await reconcileBatch(context, ledger, batch);
      if (applied === null) return;
      const { revision, content } = applied;
      if (revision.changes.some((change) => touchesInstall(change.path))) {
        const { missing } = await this.#install.check();
        if (missing !== null) {
          this.#wait(context, ledger, missing);
          for (const change of revision.changes) this.#waitChanges.add(change.path);
          return;
        }
      }
      this.#runnerWork.queueRefine(revision, content);
    });
    this.#pump();
  }

  /** The baseline, at start or at the install that ends a wait; the wait ends in the store with it. */
  async #baseline(context: SchedulerContext, ledger: Ledger): Promise<void> {
    stopWaiting(context);
    const changed = this.#waitChanges;
    this.#waitChanges = new Set();
    await baseline(context, ledger, changed);
  }

  /**
   * The install went while the daemon runs (`npm ci` removes `node_modules`
   * first; task 001-107, review wave 11 S1): the wait starts as at a start.
   * Runner parts not applied yet are dropped, and the tier in flight records
   * nothing (`recordTier`). Under the lock.
   */
  #wait(context: SchedulerContext, ledger: Ledger, missing: MissingInstall): void {
    this.#awaitingInstall = true;
    this.#runnerWork.dropRefinements();
    startWaiting(context, ledger, missing);
  }

  /**
   * Queues the checkpoint at once, unless it needs the runner: while a
   * runner failure is outstanding the runner is retried first, and while a
   * revision waits for its runner part the checkpoint follows it. Both wait
   * for the tier in flight.
   */
  async requestFullSuite(request: FullSuiteRequest = {}): Promise<CheckpointRecord> {
    const force = request.force === true;
    // An install the next reconciliation pass would find ends the wait first; still waiting,
    // nothing can be listed or keyed and the checkpoint is abandoned at once (review wave 11, B1).
    if (this.#awaitingInstall) await this.handleBatch({ trigger: "interval", paths: [] });
    const record =
      (await this.#lock.run(() => {
        const { ledger } = this.#started();
        if (this.#awaitingInstall) return abandonFullSuite(ledger);
        if (ledger.broken || this.#runnerWork.size > 0 || this.#runnerWork.refining) return null;
        return queueFullSuite(ledger, force);
      })) ??
      (await this.#runnerWork.afterTier(async () => {
        const { context, ledger } = this.#started();
        if (this.#awaitingInstall) return abandonFullSuite(ledger);
        await retryRunner(context, ledger);
        return queueFullSuite(ledger, force);
      }));
    this.#pump();
    return record;
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
   * Runs tiers one after another until the queue is empty. Selection and
   * recording hold the lock; the run and the stability re-stat do not, so
   * batches are reconciled while a tier is in flight. Spec 001 D5: "A tier in
   * flight is never cancelled by a new revision."
   *
   * Before each tier the runner work queued meanwhile is applied, in arrival
   * order, while no tier holds the runner. A tier is never selected while
   * runner work is pending: its keys would come from a revision the runner
   * has not invalidated yet.
   *
   * An error of a tier stops the pump with a note; the tier's files go back
   * to the queue, and the next batch or request starts the pump again.
   */
  #pump(): void {
    if (this.#pumping || this.#closed || !this.#ledger) return;
    this.#stalled = false;
    this.#pumping = (async () => {
      let tier: Tier | null = null;
      try {
        while (!this.#closed) {
          await this.#runnerWork.drain();
          if (this.#closed || this.#awaitingInstall) break;
          const install = await this.#install.check();
          const next = await this.#lock.run(() => {
            if (this.#awaitingInstall) return null;
            const { context, ledger } = this.#started();
            if (install.missing !== null) {
              this.#wait(context, ledger, install.missing);
              return null;
            }
            if (this.#runnerWork.size > 0) return "runner-work" as const;
            return selectTier(context, ledger);
          });
          if (next === "runner-work") continue;
          tier = next;
          if (tier === null) break;
          const { context, ledger } = this.#started();
          const selected: Tier = tier;
          const report = await executeTier(context, selected);
          const changed = await unstableInputs(context, selected);
          const installMoved = (await this.#install.stamp()) !== install.stamp;
          const moved = await this.#lock.run(() =>
            recordTier(context, ledger, selected, report, changed, installMoved),
          );
          tier = null;
          // The watcher may not have reported these yet; reconciling twice is harmless.
          if (moved.length > 0) await this.#reconcilePaths(moved);
        }
      } catch (error) {
        this.#stalled = true;
        this.#note(`scheduler stopped running tiers: ${String(error)}`);
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        if (tier !== null) await this.#requeue(tier);
      } finally {
        this.#pumping = null;
        if (!this.#closed && !this.#stalled && this.#hasWork()) this.#pump();
        else if (this.#isIdle()) for (const resolve of this.#idle.splice(0)) resolve();
      }
    })();
  }

  #hasWork(): boolean {
    return this.#runnerWork.size > 0 || (this.#ledger?.queue.size ?? 0) > 0;
  }

  /** Puts the files of a tier that never got recorded back into the queue. */
  async #requeue(tier: Tier): Promise<void> {
    await this.#lock.run(() => {
      const { ledger } = this.#started();
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
