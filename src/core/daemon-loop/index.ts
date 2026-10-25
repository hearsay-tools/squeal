import { createScheduler, type SchedulerOptions } from "../scheduler/index.js";
import { type BusyWaits, busyBackoffMs, isBusy } from "../store/index.js";
import type { Scheduler, SchedulerCloseOptions, WatcherBackend } from "../types/index.js";
import {
  type BatchRetry,
  type ChangeFeed,
  createChangeFeed,
  type WatcherTimings,
} from "../watcher/index.js";
import { readHead } from "./head.js";

export { readHead } from "./head.js";

export interface DaemonLoopOptions
  extends Omit<SchedulerOptions, "head" | "onExtraFiles" | "passes"> {
  /**
   * Errors of the change feed and of background scheduler work. With
   * `busyWaits`, a pass that failed on a busy store is retried instead
   * (task 001-422), and its episode's note goes to `busyWaits`.
   */
  readonly onError: (error: Error) => void;
  /** The backend reported lost events; a full reconciliation follows (D12). */
  readonly onDropped?: (reason: string) => void;
  /** Defaults to the backend for `process.platform`. */
  readonly backend?: WatcherBackend;
  readonly timings?: Partial<WatcherTimings>;
  /**
   * Called once each batch's revision, if any, is stored: the code pass's
   * nudge (spec 015 D4). It must not wait, so the feed's next batch is not
   * held back.
   */
  readonly afterBatch?: () => void;
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
  /**
   * Stops the change feed, then the scheduler after its tiers in flight.
   * Leaves the runner open. With `cancel` (`squeal stop`), the scheduler
   * cancels those tiers at once, under a close already begun too (D10, task
   * 001-367). Once begun, every call returns the same close.
   */
  close(options?: SchedulerCloseOptions): Promise<void>;
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
 * what changed while the baseline ran. A `run --all` plans only after a pass
 * that started after it was delivered (row 011-198): a lagging feed delays
 * it, and a failed or closed one gives it no checkpoint at an older revision.
 */
export function createDaemonLoop(options: DaemonLoopOptions): DaemonLoop {
  const { onDropped, backend, timings, afterBatch, ...rest } = options;
  let feed: ChangeFeed | null = null;
  let closing: Promise<void> | null = null;
  const scheduler = createScheduler({
    ...rest,
    head: () => readHead(options.root),
    onExtraFiles: (paths) => {
      // Not awaited: called from inside a batch, and the feed runs the update after it.
      feed?.setExtraFiles(paths).catch((error: unknown) => options.onError(toError(error)));
    },
    passes: {
      started: () => feed?.passesStarted ?? 0,
      pass: async () => {
        await feed?.reconcile("interval");
      },
      delivered: () => feed?.delivered ?? null,
    },
  });

  return {
    scheduler,
    async start() {
      await scheduler.start();
      // A stop during the start (task 001-367): no feed is left for the close to miss.
      if (closing !== null) return;
      feed = createChangeFeed({
        root: options.root,
        onBatch: async (batch) => {
          await scheduler.handleBatch(batch);
          afterBatch?.();
        },
        onError: options.onError,
        ...(options.busyWaits === undefined
          ? {}
          : { retry: passRetry(scheduler, options.busyWaits) }),
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
    close(options = {}) {
      // The scheduler's close is one promise: this one's sync part cancels, the one below waits.
      if (options.cancel === true) scheduler.close(options).catch(() => {});
      closing ??= (async () => {
        await feed?.close();
        await scheduler.close();
      })();
      return closing;
    },
  };
}

/** The pass's key in `BusyWaits`. */
const PASS = "pass";

/**
 * Task 001-422: a batch that failed on a busy store is retried as a pass at
 * once, then with `busyBackoffMs`. What it stored once it landed, a revision
 * or none, is what the episode's note names.
 */
function passRetry(scheduler: Scheduler, waits: BusyWaits): BatchRetry {
  let before: number | null = null;
  return {
    accepts: (error) => {
      if (!isBusy(error)) return false;
      before ??= scheduler.status().revision;
      waits.waiting(PASS);
      return true;
    },
    delayMs: busyBackoffMs,
    ran: () => {
      const revision = scheduler.status().revision;
      const stored = before !== null && revision !== before;
      before = null;
      waits.ran(PASS, stored ? `revision ${revision}` : "a reconciliation pass");
    },
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
