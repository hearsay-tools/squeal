import { createFsHasher, type Hasher, readObjectFormat } from "../hash/index.js";
import { type HeadState, statCandidates } from "../revision/index.js";
import type {
  AbsolutePath,
  CandidateBatch,
  CheckpointRecord,
  EpochMs,
  FullSuiteRequest,
  Policy,
  RelativePath,
  RunnerAdapter,
  Scheduler,
  SchedulerStatus,
  StateSink,
  Store,
  Validity,
  WorktreeId,
} from "../types/index.js";
import { bootstrap } from "./bootstrap.js";
import type { SchedulerContext } from "./context.js";
import { NOTHING_CHANGED } from "./context.js";
import { classify } from "./files.js";
import { WorktreeKeys } from "./keying.js";
import { Ledger } from "./ledger.js";
import { Mutex } from "./mutex.js";
import { priorityOf } from "./queue.js";
import { type FailureDescriber, firstLineSummary } from "./records.js";
import { applyRevision } from "./revision.js";
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
  /** Summary and fingerprint of a failure. Defaults to `firstLineSummary` until 001-21 lands. */
  readonly describeFailure?: FailureDescriber;
  /**
   * The full extra-file list whenever it grows. Called while a batch is being
   * handled: hand it to `ChangeFeed.setExtraFiles` without awaiting, because
   * the feed delivers the next batch only after this one.
   */
  readonly onExtraFiles?: (paths: readonly RelativePath[]) => void;
  /** Errors of background work (tiers). Batch errors reject `handleBatch`. */
  readonly onError?: (error: Error) => void;
  readonly hasher?: Hasher;
  /** Allow-listed variables for the environment hash. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => EpochMs;
}

/** Notes kept for status; older ones are dropped. */
const MAX_NOTES = 20;

/** Creates the scheduler of one worktree. Call `start` before anything else. */
export function createScheduler(options: SchedulerOptions): Scheduler {
  return new TierScheduler(options);
}

class TierScheduler implements Scheduler {
  readonly #lock = new Mutex();
  readonly #notes: string[] = [];
  readonly #idle: (() => void)[] = [];
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
        keys,
        hasher,
        runsDir: options.runsDir,
        describe: options.describeFailure ?? firstLineSummary,
        head: options.head,
        now: options.now ?? Date.now,
        note: (message) => this.#note(message),
      };
      const ledger = new Ledger(context);
      await bootstrap(context, ledger);
      this.#context = context;
      this.#ledger = ledger;
    });
    this.#pump();
  }

  async handleBatch(batch: CandidateBatch): Promise<void> {
    if (this.#closed) return;
    await this.#lock.run(async () => {
      const { context, ledger } = this.#started();
      const revision = await context.keys.reconcile(batch, context.head);
      if (revision === null) return;
      ledger.revision = { number: revision.number, head: revision.head, dirty: revision.dirty };
      for (const change of revision.changes) ledger.tierChanges?.add(change.path);
      await applyRevision(context, ledger, revision);
      ledger.commit();
    });
    this.#pump();
  }

  async requestFullSuite(request: FullSuiteRequest = {}): Promise<CheckpointRecord> {
    const record = await this.#lock.run(() => {
      const { ledger } = this.#started();
      return queueFullSuite(ledger, request.force === true);
    });
    this.#pump();
    return record;
  }

  status(): SchedulerStatus {
    const ledger = this.#ledger;
    const testFiles = counts();
    const checks = counts();
    let running = 0;
    for (const file of ledger?.files.values() ?? []) {
      const validity = classify(file);
      testFiles[validity]++;
      checks[validity] += file.checks.length;
      if (file.phase === "running") running++;
    }
    const c = ledger?.counters;
    const active = ledger?.checkpoints.active ?? null;
    return {
      revision: ledger?.revision.number ?? 0,
      testFiles,
      checks,
      queued: ledger?.queue.size ?? 0,
      running,
      runs: {
        started: c?.started ?? 0,
        completed: c?.completed ?? 0,
        crashed: c?.crashed ?? 0,
        timedOut: c?.timedOut ?? 0,
      },
      lookups: { hits: c?.hits ?? 0, misses: c?.misses ?? 0 },
      discarded: c?.discarded ?? 0,
      checkpoint:
        active === null
          ? null
          : { id: active.record.id, kind: active.record.kind, remaining: active.remaining },
      notes: [...this.#notes],
    };
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
    await this.#lock.run(() => this.#ledger?.checkpoints.finish("abandoned"));
    for (const resolve of this.#idle.splice(0)) resolve();
  }

  /**
   * Runs tiers one after another until the queue is empty. Selection and
   * recording hold the lock; the run and the stability re-stat do not, so
   * batches are reconciled while a tier is in flight. Spec 001 D5: "A tier in
   * flight is never cancelled by a new revision."
   *
   * An error stops the pump with a note; the tier's files go back to the
   * queue, and the next batch or request starts the pump again.
   */
  #pump(): void {
    if (this.#pumping || this.#closed || !this.#ledger) return;
    this.#stalled = false;
    this.#pumping = (async () => {
      let tier: Tier | null = null;
      try {
        while (!this.#closed) {
          tier = await this.#lock.run(() => {
            const { context, ledger } = this.#started();
            return selectTier(context, ledger);
          });
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
        if (!this.#closed && !this.#stalled && (this.#ledger?.queue.size ?? 0) > 0) this.#pump();
        else if (this.#isIdle()) for (const resolve of this.#idle.splice(0)) resolve();
      }
    })();
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
    return this.#pumping === null && (this.#stalled || (this.#ledger?.queue.size ?? 0) === 0);
  }

  #started(): { context: SchedulerContext; ledger: Ledger } {
    if (!this.#context || !this.#ledger) throw new Error("squeal scheduler: not started");
    return { context: this.#context, ledger: this.#ledger };
  }

  #note(message: string): void {
    this.#notes.push(message);
    if (this.#notes.length > MAX_NOTES) this.#notes.shift();
  }
}

function counts(): Record<Validity, number> {
  return { current: 0, pending: 0, stale: 0, unknown: 0 };
}
