import { realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { toAbsolute } from "../fs/index.js";
import { readGitHead } from "../status/git-head.js";
import {
  type AbsolutePath,
  type CandidateBatch,
  type CommitSha,
  type DeliveredPass,
  type EpochMs,
  type RelativePath,
  type RevisionTrigger,
  WATCHER_TIMINGS,
  type WatcherBackend,
  type WatchHint,
  type WatchSpec,
  type WatchSubscription,
} from "../types/index.js";
import { ATOMIC_SAVE_HOLD_MS, TempHold } from "./atomic-save.js";
import { createWatcherBackend } from "./backend.js";
import { BatchRetries, type BatchRetry, toError } from "./batch-retry.js";
import {
  type CandidateContext,
  candidatesForReconcile,
  candidatesFromHints,
  committedSince,
  type HintCandidates,
} from "./candidates.js";
import { Debouncer } from "./debounce.js";
import { Exclusions } from "./exclusions.js";
import { type GitStatus, gitStatus } from "./git.js";
import { LinkedWatches } from "./linked-watch.js";
import { UnlistedDirs } from "./unlisted-dirs.js";
import { isWatchLimit, watchLimitNote } from "./watch-limit.js";
import { buildWatchSpec, sameWatchSpec } from "./watch-spec.js";

export interface ChangeFeedOptions {
  /** The worktree root. Resolved with `realpath` on start. */
  readonly root: AbsolutePath;
  /** Receives every batch, one at a time: the next waits for the returned promise. */
  readonly onBatch: (batch: CandidateBatch) => void | Promise<void>;
  /** Git, filesystem, backend and `onBatch` failures. The feed keeps running. */
  readonly onError: (error: Error) => void;
  /**
   * The backend reported lost events. A full reconciliation follows. Spec 001
   * D12: "full reconciliation pass; a note in status."
   */
  readonly onDropped?: (reason: string) => void;
  /**
   * Each batch delivered, a watch batch or a pass, with when its task started (row 011-200: the
   * daemon stores it for status). Called after `onBatch`; must not throw or wait.
   */
  readonly onDelivered?: (startedAt: EpochMs) => void;
  /** The clock of a pass's and a batch's start. Defaults to `Date.now`. */
  readonly now?: () => EpochMs;
  /** Defaults to the backend for `process.platform`. */
  readonly backend?: WatcherBackend;
  /** A batch that failed on a busy store is a pass to retry, not an error (task 001-422). */
  readonly retry?: BatchRetry;
  /** Paths re-stat'ed on every reconciliation pass: the stat cache. */
  readonly trackedPaths?: () => Iterable<RelativePath>;
  /** Ignored files watched anyway because a closure references them. */
  readonly extraFiles?: readonly RelativePath[];
  readonly timings?: Partial<WatcherTimings>;
}

export type WatcherTimings = { -readonly [K in keyof typeof WATCHER_TIMINGS]: number } & {
  /** How long an atomic save's temp file is held out of batches (`TempHold`). */
  atomicSaveHoldMs: number;
};

export interface ChangeFeed {
  /** The spec the backend currently watches; `null` before `start`. */
  readonly spec: WatchSpec | null;
  /** Starts the backend, then emits a reconciliation batch (`interval`, see `Feed.start`). */
  start(): Promise<void>;
  /**
   * Queues a reconciliation pass and resolves once its batch was delivered. A
   * pass already queued and not yet started is joined instead (task 001-299).
   */
  reconcile(trigger: RevisionTrigger): Promise<void>;
  /** How many reconciliation passes started, retries included (row 011-198). */
  readonly passesStarted: number;
  /** The last pass whose batch was delivered; `null` before the first (row 011-198). */
  readonly delivered: DeliveredPass | null;
  /** Replaces the extra files and updates the watch; a reconciliation pass follows when it changed. */
  setExtraFiles(paths: readonly RelativePath[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * Turns watcher hints and reconciliation passes into candidate batches.
 *
 * Spec 001 D2: debounced batches (100 ms quiet, 500 ms maximum); ignore rules
 * from git in three layers; "A reconciliation pass runs every 30 s when idle
 * and on daemon start". D12: "Watcher backend error or dropped-events signal:
 * full reconciliation pass".
 *
 * Batches are delivered in order and never overlap. Watch batches with no
 * candidates left after filtering are not emitted; reconciliation batches
 * always are, so the caller can tell that a pass completed.
 */
export function createChangeFeed(options: ChangeFeedOptions): ChangeFeed {
  return new Feed(options);
}

/** Basenames whose change means the watch-time exclusions may be out of date. */
const SPEC_INPUTS = new Set([".gitignore", ".git"]);

class Feed implements ChangeFeed {
  spec: WatchSpec | null = null;
  passesStarted = 0;
  delivered: DeliveredPass | null = null;
  private root: AbsolutePath;
  private readonly backend: WatcherBackend;
  private readonly timings: WatcherTimings;
  private readonly debouncer: Debouncer<AbsolutePath>;
  private readonly tempHold: TempHold;
  private extraFiles: RelativePath[];
  private sub: WatchSubscription | null = null;
  private linked: LinkedWatches | null = null;
  /**
   * Symlinked directories seen, observed or not, with their target's realpath.
   * `fs.watch` follows a link, so a write behind one also reports the link.
   */
  private linkTargets = new Map<RelativePath, AbsolutePath>();
  private queue: Promise<void> = Promise.resolve();
  /** The reconciliation queued and not yet started, which later requests join. */
  private pending: { trigger: RevisionTrigger; done: Promise<void> } | null = null;
  /**
   * `HEAD` read just before the last delivered pass's git status; `undefined` before the first
   * (row 011-199). The feed keeps its own: the scheduler reads the `HEAD` it records after the
   * pass's status, so a commit between the two would hide its files from a diff from there.
   */
  private passHead: CommitSha | undefined;
  /** Set once the system refused a watch: the note is given once per feed. */
  private atWatchLimit = false;
  /** Made again by `start`, with the resolved root. */
  private unlisted: UnlistedDirs;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly retries: BatchRetries;

  constructor(private readonly options: ChangeFeedOptions) {
    this.retries = new BatchRetries(options.retry, options.onError);
    this.root = options.root;
    this.unlisted = new UnlistedDirs(this.root);
    this.backend = options.backend ?? createWatcherBackend(process.platform);
    this.timings = {
      ...WATCHER_TIMINGS,
      atomicSaveHoldMs: ATOMIC_SAVE_HOLD_MS,
      ...options.timings,
    };
    this.extraFiles = [...(options.extraFiles ?? [])];
    this.debouncer = new Debouncer((paths) => this.onDebounced(paths), this.timings);
    this.tempHold = new TempHold(this.timings.atomicSaveHoldMs, (path) => {
      if (!this.closed) this.debouncer.push([toAbsolute(this.root, path)]);
    });
  }

  async start(): Promise<void> {
    this.root = await realpath(this.root);
    this.unlisted = new UnlistedDirs(this.root);
    const status = await gitStatus(this.root);
    this.spec = await buildWatchSpec(this.root, this.extraFiles, status);
    const listener = {
      onHints: (hints: readonly WatchHint[]) => this.onHints(hints),
      onDropped: (reason: string) => this.onLost(() => this.options.onDropped?.(reason)),
      onError: (error: Error) => this.onBackendError(error),
    };
    this.sub = await this.backend.watch(this.spec, listener);
    this.linked = new LinkedWatches(this.root, this.backend, listener);
    // Review wave 10d, S1: `start` is the stat cache's bootstrap revision only (`keys.bootstrap`),
    // whose changes were made while no daemon ran. This pass holds what changed while this
    // daemon started, an agent's edit among them, so it is an ordinary reconciliation.
    await this.reconcile("interval");
  }

  reconcile(trigger: RevisionTrigger): Promise<void> {
    if (this.pending) {
      // "interval" also checks the install (scheduler), so a joined pass keeps it.
      if (trigger === "interval") this.pending.trigger = trigger;
      return this.pending.done;
    }
    const pending = { trigger, done: Promise.resolve() };
    this.pending = pending;
    pending.done = this.enqueue(
      () => {
        this.pending = null;
        return this.reconcileNow(pending.trigger);
      },
      () => pending.trigger,
    );
    return pending.done;
  }

  /**
   * The rebuild also meets any ignored directory that appeared since the last one, so the backend
   * may replace its watcher here too; the pass finds what that dropped (row 011-187).
   */
  setExtraFiles(paths: readonly RelativePath[]): Promise<void> {
    this.extraFiles = [...paths];
    return this.enqueue(
      async () => {
        if (await this.rebuildSpec()) await this.reconcileNow("watch");
      },
      () => "watch",
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.debouncer.cancel();
    this.tempHold.close();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.retries.close();
    await this.sub?.close();
    await this.queue;
    await this.linked?.close();
  }

  private onHints(hints: readonly WatchHint[]): void {
    if (this.closed) return;
    this.debouncer.push(hints.map((h) => h.path));
    this.armIdle();
  }

  /**
   * At the system's watch limit chokidar reports one error per path it cannot
   * watch: the first gives one note and one pass, the rest nothing; the idle
   * pass finds what those paths' watches would have (task 001-299).
   */
  private onBackendError(error: Error): void {
    if (!isWatchLimit(error)) this.onLost(() => this.options.onError(error));
    else if (!this.atWatchLimit) {
      this.atWatchLimit = true;
      this.onLost(() => this.options.onError(watchLimitNote(error)));
    }
  }

  /** Backend errors are treated like dropped events: events may be missing. */
  private onLost(report: () => void): void {
    if (this.closed) return;
    report();
    void this.reconcile("dropped-events");
  }

  private onDebounced(paths: AbsolutePath[]): void {
    void this.enqueue(
      async () => {
        const startedAt = this.now();
        const specChanged = paths.some((p) => SPEC_INPUTS.has(basename(p)));
        if (specChanged) this.unlisted.clear();
        let rewatched = specChanged ? await this.rebuildSpec() : false;
        const hinted = await candidatesFromHints(this.context(), paths);
        const ignoredDirs = hinted.ignoredDirs.filter((dir) => !this.unlisted.holds(dir));
        if (ignoredDirs.length > 0 && !specChanged) {
          const before = this.spec;
          rewatched = await this.rebuildSpec();
          if (this.spec === before) await this.unlisted.record(ignoredDirs);
        }
        const kept = this.tempHold.filter(hinted.paths, this.trackedPaths);
        if (kept.length > 0) await this.emit({ trigger: "watch", paths: kept }, startedAt);
        // Paths that were excluded until now were never watched, and a replaced watch may have
        // dropped an edit; git status and the re-stat find them. So does the walk of a linked
        // directory, which appeared, went or moved with a link of this batch.
        if (rewatched || (await this.relinked(hinted))) await this.reconcileNow("watch");
      },
      () => "watch",
    );
  }

  /**
   * `HEAD` is read before git status, so a commit made between the two is in the next diff. The
   * pass counts as delivered only once `onBatch` took its batch (row 011-198): a failure, a close
   * first or a retry in its place leaves `delivered` as it was.
   */
  private async reconcileNow(trigger: RevisionTrigger): Promise<void> {
    this.passesStarted += 1;
    const pass = { number: this.passesStarted, startedAt: this.now() };
    const head = readGitHead(this.root);
    const status = await gitStatus(this.root);
    await this.rebuildSpec(status);
    const committed = await committedSince(this.root, this.passHead, head);
    const listed = [...status.paths, ...committed];
    const { paths, linkedDirs, links } = await candidatesForReconcile(this.context(), listed);
    this.linkTargets = new Map(links);
    await this.linked?.update(linkedDirs);
    const batch = { trigger, paths: this.tempHold.filter(paths, this.trackedPaths) };
    if (!(await this.emit(batch, pass.startedAt))) return;
    this.passHead = head;
    this.delivered = pass;
  }

  /** True when a link of the batch is new, gone or points elsewhere than when last seen. */
  private async relinked(hinted: HintCandidates): Promise<boolean> {
    let changed = false;
    const links = new Set(hinted.linkedDirs);
    for (const link of links) {
      const target = await realpath(join(this.root, link)).catch(() => null);
      if (target === null || this.linkTargets.get(link) === target) continue;
      this.linkTargets.set(link, target);
      changed = true;
    }
    for (const { path } of hinted.paths) {
      if (links.has(path) || !this.linkTargets.delete(path)) continue;
      changed = true;
    }
    return changed;
  }

  /**
   * Rebuilds the spec and updates the watch. True when the watch changed: a path excluded until
   * now was never watched, and a watch the backend replaced may drop an event in flight (row
   * 011-183: chokidar's old watcher closed before its stat of an edit returned).
   */
  private async rebuildSpec(status?: GitStatus): Promise<boolean> {
    const current = this.spec;
    if (!current || !this.sub) return false;
    const next = await buildWatchSpec(this.root, this.extraFiles, status);
    if (sameWatchSpec(current, next)) return false;
    await this.sub.update(next);
    this.spec = next;
    this.unlisted.clear();
    return true;
  }

  private context(): CandidateContext {
    const spec = this.spec ?? { root: this.root, excluded: [], extraFiles: [] };
    return {
      root: this.root,
      exclusions: new Exclusions(spec),
      extraFiles: new Set(this.extraFiles),
      trackedPaths: this.trackedPaths,
    };
  }

  private readonly trackedPaths = (): Iterable<RelativePath> => this.options.trackedPaths?.() ?? [];

  /** False when a close kept the batch from `onBatch`; `startedAt` is when its task started. */
  private async emit(batch: CandidateBatch, startedAt: EpochMs): Promise<boolean> {
    if (this.closed) return false;
    await this.options.onBatch(batch);
    this.options.onDelivered?.(startedAt);
    return true;
  }

  private readonly now = (): EpochMs => (this.options.now ?? Date.now)();

  /**
   * Runs tasks one at a time. A failed task is reported and does not stop the
   * queue; one that delivers batches names the trigger it retries as (`retry`).
   */
  private enqueue(task: () => Promise<void>, retryAs?: () => RevisionTrigger): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.closed) return;
      try {
        await task();
      } catch (error) {
        const pass = retryAs && (() => this.reconcileNow(retryAs()));
        await this.retries.failed(toError(error), pass);
      } finally {
        this.armIdle();
      }
    });
    this.queue = run;
    return run;
  }

  /** Schedules the idle reconciliation; any hint or batch pushes it back. */
  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.closed) return;
    this.idleTimer = setTimeout(() => {
      if (this.debouncer.pending) this.armIdle();
      else void this.reconcile("interval");
    }, this.timings.reconcileIntervalMs);
    this.idleTimer.unref();
  }
}
