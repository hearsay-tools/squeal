import { createFsHasher, type Hasher, readObjectFormat } from "../hash/index.js";
import { testFileId } from "../keys/index.js";
import { type HeadState, statCandidates } from "../revision/index.js";
import { describeFailure } from "../state/index.js";
import {
  type AbsolutePath,
  type CandidateBatch,
  type CheckpointRecord,
  type EpochMs,
  type FileChange,
  type FullSuiteRequest,
  type Policy,
  type RelativePath,
  type Revision,
  type RunnerAdapter,
  refinedMetaKey,
  type Scheduler,
  type SchedulerStatus,
  type StateSink,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { reconcileBatch } from "./batch.js";
import { bootstrap } from "./bootstrap.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import { appendNote, plainText } from "./notes.js";
import { priorityOf } from "./queue.js";
import type { FailureDescriber } from "./records.js";
import { applyRunnerPart, fetchRunnerPart } from "./refinement.js";
import { type ContentRekey, retryRunner } from "./revision.js";
import { statusOf } from "./status.js";
import {
  executeTier,
  queueFullSuite,
  recordTier,
  selectTier,
  type Tier,
  unstableInputs,
} from "./tiers.js";

export interface SchedulerOptions {
  /** Worktree root. Must be its realpath, like the runner's. */
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly runner: RunnerAdapter;
  /** Known state and transitions (task 001-21). */
  readonly sink: StateSink;
  readonly policy: Policy;
  readonly squealVersion: string;
  /** `StorePaths.runsDir`; each run logs to `<runsDir>/<run-id>` (D1). */
  readonly runsDir: AbsolutePath;
  /** `HEAD` and the dirty flag for new revisions. */
  readonly head: () => Promise<HeadState>;
  /** Summary and fingerprint of a failure. Defaults to `describeFailure` (D6). */
  readonly describeFailure?: FailureDescriber;
  /**
   * The full extra-file list whenever it grows. Called while a batch is being
   * handled: hand it to `ChangeFeed.setExtraFiles` without awaiting, because
   * the feed delivers the next batch only after this one.
   */
  readonly onExtraFiles?: (paths: readonly RelativePath[]) => void;
  /**
   * Called with the changes of every new revision, inside the transaction
   * that stores it. Returns the policy to apply from this revision on, or
   * `null` to keep the current one; the daemon reloads when the changes
   * include `squeal.config.json` (spec 001 D11, review S3). A new `inputs`
   * re-selects the declared inputs and re-assembles every closure; a new
   * `env.allowlist` moves every environment hash and reads the environments
   * again, the same paths a content or config change takes. `runner.*` keys
   * apply from the next tier; `baseline.onStart` only at the next start.
   */
  readonly reloadPolicy?: (changes: readonly FileChange[]) => Policy | null;
  /**
   * Errors of background work: tiers, the runner part of a revision,
   * persisting notes. Errors storing a revision reject `handleBatch`.
   */
  readonly onError?: (error: Error) => void;
  readonly hasher?: Hasher;
  /** Allow-listed variables for the environment hash. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => EpochMs;
}

/** Notes kept in memory for `status()`; older ones are dropped. */
const MAX_NOTES = 20;

/**
 * Work that calls the runner outside a tier: the refinement of a revision, a
 * `run --all` while a runner failure is outstanding. `run` never rejects;
 * `cancel` settles it when the scheduler closes first.
 */
interface RunnerTask {
  run(): Promise<void>;
  cancel(): void;
}

/** Creates the scheduler of one worktree. Call `start` before anything else. */
export function createScheduler(options: SchedulerOptions): Scheduler {
  return new TierScheduler(options);
}

class TierScheduler implements Scheduler {
  readonly #lock = new Mutex();
  readonly #notes: string[] = [];
  readonly #idle: (() => void)[] = [];
  /** Runner work in arrival order, applied between tiers by the pump. */
  readonly #runnerWork: RunnerTask[] = [];
  /** A refinement is in its runner phase: shifted off `#runnerWork`, not applied yet. */
  #refining = false;
  /** Test files whose closure went stale while a refinement fetched it; the next one resolves them again. */
  readonly #carried = new Map<string, TestFileRef>();
  #context: SchedulerContext | null = null;
  #ledger: Ledger | null = null;
  #pumping: Promise<void> | null = null;
  #closed = false;
  /** The pump stopped on an error; idle until the next batch or request. */
  #stalled = false;

  constructor(private readonly options: SchedulerOptions) {}

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
      await bootstrap(context, ledger);
      this.#context = context;
    });
    this.#pump();
  }

  /**
   * Stores the revision a batch creates and returns: the revision row, stat
   * cache, content re-key, `queued` phases and known states, in one
   * transaction. The runner part is queued and applied by the pump after the
   * tier in flight, in batch order (`#refine`).
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
      const applied = await reconcileBatch(context, ledger, batch);
      if (applied === null) return;
      const { revision, content } = applied;
      this.#runnerWork.push({ run: () => this.#refine(revision, content), cancel: () => {} });
    });
    this.#pump();
  }

  /**
   * The runner part of one revision, in two phases (review wave 4.5, S3).
   * The runner phase calls the runner without the lock, so batches are
   * reconciled meanwhile; the apply phase takes the lock, applies what the
   * runner said, and commits it with the revision as refined (D2 as
   * amended). Never rejects: an error is a note, and the revision counts as
   * refined so no wait hangs on it.
   */
  async #refine(revision: Revision, content: ContentRekey): Promise<void> {
    const { context, ledger } = this.#started();
    this.#refining = true;
    try {
      ledger.refineChanges = new Set();
      const carried = [...this.#carried.values()];
      this.#carried.clear();
      const part = await fetchRunnerPart(context, ledger, revision, content, carried);
      await this.#lock.run(async () => {
        const changedMeanwhile = ledger.refineChanges ?? new Set<RelativePath>();
        ledger.refineChanges = null;
        const stale = await applyRunnerPart(context, ledger, part, changedMeanwhile);
        for (const ref of stale) this.#carried.set(testFileId(ref), ref);
        ledger.commit({ refined: revision.number });
      });
    } catch (error) {
      this.#backgroundError(`could not apply revision ${revision.number}`, error);
      this.#refinedAfterError(revision.number);
    } finally {
      ledger.refineChanges = null;
      this.#refining = false;
    }
  }

  /**
   * Queues the checkpoint at once, unless it needs the runner: while a
   * runner failure is outstanding the runner is retried first, and while a
   * revision waits for its runner part the checkpoint follows it. Both wait
   * for the tier in flight.
   */
  async requestFullSuite(request: FullSuiteRequest = {}): Promise<CheckpointRecord> {
    const force = request.force === true;
    const record =
      (await this.#lock.run(() => {
        const { ledger } = this.#started();
        if (ledger.broken || this.#runnerWork.length > 0 || this.#refining) return null;
        return queueFullSuite(ledger, force);
      })) ??
      (await this.#afterTier(async () => {
        const { context, ledger } = this.#started();
        await retryRunner(context, ledger);
        return queueFullSuite(ledger, force);
      }));
    this.#pump();
    return record;
  }

  status(): SchedulerStatus {
    return statusOf(this.#ledger, this.#notes);
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
    for (const task of this.#runnerWork.splice(0)) task.cancel();
    await this.#lock.run(() => this.#ledger?.checkpoints.finish("abandoned"));
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
          await this.#drainRunnerWork();
          if (this.#closed) break;
          const next = await this.#lock.run(() => {
            if (this.#runnerWork.length > 0) return "runner-work" as const;
            const { context, ledger } = this.#started();
            return selectTier(context, ledger);
          });
          if (next === "runner-work") continue;
          tier = next;
          if (tier === null) break;
          const { context, ledger } = this.#started();
          const selected: Tier = tier;
          const report = await executeTier(context, selected);
          const changed = await unstableInputs(context, selected);
          const moved = await this.#lock.run(() =>
            recordTier(context, ledger, selected, report, changed),
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

  /** Applies the queued runner work, oldest first. */
  async #drainRunnerWork(): Promise<void> {
    while (!this.#closed) {
      const task = this.#runnerWork.shift();
      if (!task) return;
      await task.run();
    }
  }

  /** Runs `task` under the lock once the tier in flight and the runner work before it are done. */
  #afterTier<T>(task: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("squeal scheduler: closed"));
    return new Promise<T>((resolve, reject) => {
      this.#runnerWork.push({
        run: () => this.#lock.run(task).then(resolve, reject),
        cancel: () => reject(new Error("squeal scheduler: closed")),
      });
      this.#pump();
    });
  }

  #hasWork(): boolean {
    return this.#runnerWork.length > 0 || (this.#ledger?.queue.size ?? 0) > 0;
  }

  /** Puts the files of a tier that never got recorded back into the queue. */
  async #requeue(tier: Tier): Promise<void> {
    await this.#lock.run(() => {
      const { ledger } = this.#started();
      for (const { file } of tier.files) {
        ledger.setRunning(file, null);
        if (ledger.files.has(file.id)) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
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

  /**
   * A refinement that threw is not pending any more: nothing retries it, and
   * its note says what failed. Its revision is recorded as refined, so waits
   * do not wait for it forever (D2 as amended).
   */
  #refinedAfterError(revision: number): void {
    const { store, worktreeId } = this.options;
    try {
      store.transaction(() => {
        const key = refinedMetaKey(worktreeId);
        const previous = Number(store.meta.get(key) ?? Number.NaN);
        if (!(previous >= revision)) store.meta.set(key, String(revision));
      });
    } catch (error) {
      this.#backgroundError(`could not record revision ${revision} as refined`, error);
    }
  }

  /** An error of work no caller awaits: a note for status, and `onError`. */
  #backgroundError(subject: string, error: unknown): void {
    this.#note(`${subject}: ${String(error)}`);
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  /** Keeps a note for `status()` and persists it for `squeal status` (D7, review S6). */
  #note(coloured: string): void {
    const message = plainText(coloured);
    this.#notes.push(message);
    if (this.#notes.length > MAX_NOTES) this.#notes.shift();
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
