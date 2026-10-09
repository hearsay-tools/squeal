import { createScheduler, type SchedulerOptions } from "../scheduler/index.js";
import type { Scheduler, WatcherBackend } from "../types/index.js";
import { type ChangeFeed, createChangeFeed, type WatcherTimings } from "../watcher/index.js";
import { readHead } from "./head.js";

export { readHead } from "./head.js";

export interface DaemonLoopOptions extends Omit<SchedulerOptions, "head" | "onExtraFiles"> {
  /** Errors of the change feed and of background scheduler work. */
  readonly onError: (error: Error) => void;
  /** The backend reported lost events; a full reconciliation follows (D12). */
  readonly onDropped?: (reason: string) => void;
  /** Defaults to the backend for `process.platform`. */
  readonly backend?: WatcherBackend;
  readonly timings?: Partial<WatcherTimings>;
}

/** A worktree's watcher feeding its scheduler. Task 001-30 runs one per daemon. */
export interface DaemonLoop {
  readonly scheduler: Scheduler;
  /** Starts the scheduler (baseline), then the change feed. */
  start(): Promise<void>;
  /**
   * Queues a reconciliation pass and resolves once its revision, if any, is
   * stored (`status --wait`, lessons defect 30). Before `start`, resolves at once.
   */
  reconcile(): Promise<void>;
  /** Stops the change feed, then the scheduler after its tier in flight. Leaves the runner open. */
  close(): Promise<void>;
}

/**
 * Glue between the change feed and the scheduler.
 *
 * Every `CandidateBatch` goes to `Scheduler.handleBatch`, one at a time: the
 * feed delivers the next batch only after the previous one's promise settled,
 * and the scheduler serializes batches with its own work, so `reconcile`
 * never overlaps on the stat cache. `handleBatch` settles once the revision
 * is stored, never behind a running tier (D2), so the next batch is not held
 * back either. The scheduler starts first, so the feed starts with the stat
 * cache's paths and the extra files the baseline found (gitignored closure
 * paths and the installed lockfile, D2); later additions go to
 * `ChangeFeed.setExtraFiles`. The feed's own start reconciliation catches
 * what changed while the baseline ran.
 */
export function createDaemonLoop(options: DaemonLoopOptions): DaemonLoop {
  const { onDropped, backend, timings, ...rest } = options;
  let feed: ChangeFeed | null = null;
  const scheduler = createScheduler({
    ...rest,
    head: () => readHead(options.root),
    onExtraFiles: (paths) => {
      // Not awaited: called from inside a batch, and the feed runs the update after it.
      feed?.setExtraFiles(paths).catch((error: unknown) => options.onError(toError(error)));
    },
  });

  return {
    scheduler,
    async start() {
      await scheduler.start();
      feed = createChangeFeed({
        root: options.root,
        onBatch: (batch) => scheduler.handleBatch(batch),
        onError: options.onError,
        ...(onDropped === undefined ? {} : { onDropped }),
        ...(backend === undefined ? {} : { backend }),
        ...(timings === undefined ? {} : { timings }),
        trackedPaths: () => scheduler.trackedPaths(),
        extraFiles: scheduler.extraFiles(),
      });
      await feed.start();
    },
    async reconcile() {
      await feed?.reconcile("interval");
    },
    async close() {
      await feed?.close();
      await scheduler.close();
    },
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
