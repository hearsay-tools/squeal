import { realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { toAbsolute } from "../fs/index.js";
import {
  type AbsolutePath,
  type CandidateBatch,
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
import {
  type CandidateContext,
  candidatesForReconcile,
  candidatesFromHints,
  type HintCandidates,
} from "./candidates.js";
import { Debouncer } from "./debounce.js";
import { Exclusions } from "./exclusions.js";
import { type GitStatus, gitStatus } from "./git.js";
import { LinkedWatches } from "./linked-watch.js";
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
  /** Defaults to the backend for `process.platform`. */
  readonly backend?: WatcherBackend;
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
  /** Queues a reconciliation pass and resolves once its batch was delivered. */
  reconcile(trigger: RevisionTrigger): Promise<void>;
  /** Replaces the extra files and updates the watch. */
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
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: ChangeFeedOptions) {
    this.root = options.root;
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
    const status = await gitStatus(this.root);
    this.spec = await buildWatchSpec(this.root, this.extraFiles, status);
    const listener = {
      onHints: (hints: readonly WatchHint[]) => this.onHints(hints),
      onDropped: (reason: string) => this.onLost(() => this.options.onDropped?.(reason)),
      onError: (error: Error) => this.onLost(() => this.options.onError(error)),
    };
    this.sub = await this.backend.watch(this.spec, listener);
    this.linked = new LinkedWatches(this.root, this.backend, listener);
    // Review wave 10d, S1: `start` is the stat cache's bootstrap revision only (`keys.bootstrap`),
    // whose changes were made while no daemon ran. This pass holds what changed while this
    // daemon started, an agent's edit among them, so it is an ordinary reconciliation.
    await this.reconcile("interval");
  }

  reconcile(trigger: RevisionTrigger): Promise<void> {
    return this.enqueue(() => this.reconcileNow(trigger));
  }

  setExtraFiles(paths: readonly RelativePath[]): Promise<void> {
    this.extraFiles = [...paths];
    return this.enqueue(async () => {
      await this.rebuildSpec();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.debouncer.cancel();
    this.tempHold.close();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.sub?.close();
    await this.queue;
    await this.linked?.close();
  }

  private onHints(hints: readonly WatchHint[]): void {
    if (this.closed) return;
    this.debouncer.push(hints.map((h) => h.path));
    this.armIdle();
  }

  /** Backend errors are treated like dropped events: events may be missing. */
  private onLost(report: () => void): void {
    if (this.closed) return;
    report();
    void this.reconcile("dropped-events");
  }

  private onDebounced(paths: AbsolutePath[]): void {
    void this.enqueue(async () => {
      const specChanged = paths.some((p) => SPEC_INPUTS.has(basename(p)));
      let widened = specChanged ? await this.rebuildSpec() : false;
      const hinted = await candidatesFromHints(this.context(), paths);
      if (hinted.ignoredDirs.length > 0 && !specChanged) widened = await this.rebuildSpec();
      const kept = this.tempHold.filter(hinted.paths, this.trackedPaths);
      if (kept.length > 0) await this.emit({ trigger: "watch", paths: kept });
      // Paths that were excluded until now were never watched; git status finds them. So does
      // the walk of a linked directory, which appeared, went or moved with a link of this batch.
      if (widened || (await this.relinked(hinted))) await this.reconcileNow("watch");
    });
  }

  private async reconcileNow(trigger: RevisionTrigger): Promise<void> {
    const status = await gitStatus(this.root);
    await this.rebuildSpec(status);
    const { paths, linkedDirs, links } = await candidatesForReconcile(this.context(), status.paths);
    this.linkTargets = new Map(links);
    await this.linked?.update(linkedDirs);
    await this.emit({ trigger, paths: this.tempHold.filter(paths, this.trackedPaths) });
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

  /** Rebuilds the spec and updates the watch. True when some path is no longer excluded. */
  private async rebuildSpec(status?: GitStatus): Promise<boolean> {
    const current = this.spec;
    if (!current || !this.sub) return false;
    const next = await buildWatchSpec(this.root, this.extraFiles, status);
    if (sameWatchSpec(current, next)) return false;
    await this.sub.update(next);
    this.spec = next;
    return current.excluded.some((p) => !next.excluded.includes(p));
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

  private async emit(batch: CandidateBatch): Promise<void> {
    if (this.closed) return;
    await this.options.onBatch(batch);
  }

  /** Runs tasks one at a time. A failed task is reported and does not stop the queue. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.closed) return;
      try {
        await task();
      } catch (error) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
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
