import { existsSync, rmSync } from "node:fs";
import type { ObjectFormat } from "../../hash/index.js";
import { BUSY_SLICE_MS, busyBackoffMs, isBusy, withBusySliceSync } from "../../store/index.js";
import type { AbsolutePath, CheckKey, EpochMs, Policy } from "../../types/index.js";
import {
  type CodeStore,
  type CodeStoreOpenFailure,
  isCodeStoreOpenFailure,
  openCodeStore,
} from "../store/index.js";
import { type DropCause, Drops } from "./drops.js";
import {
  type Mapper,
  type MapWorker,
  mapWorkerScript,
  threadMapper,
  workerMapper,
} from "./mapper.js";
import { Pace } from "./pace.js";
import type { SharedRecord } from "./parts.js";
import { type BlobCache, COVERAGE_PROVIDER_VERSION } from "./record.js";
import type { CoverageRun, CoveredFile, ResultKeyOf } from "./types.js";

/**
 * How long a mapped record waits for its result to be stored: the scheduler
 * stores a run's results after its report, its checks and a rerun if any.
 * A result never stored under this run (withheld, a crash) drops its record.
 */
export const RESULT_WAITS_MS = [0, 250, 1_000, 5_000, 30_000] as const;

/**
 * Row 015-79: how long, by the clock, a mapped record retries a code store
 * whose write lock another connection keeps, apart from its result waits.
 */
export const BUSY_BUDGET_MS = 120_000;

export interface CoverageWriterOptions {
  readonly commonDir: AbsolutePath;
  readonly format: ObjectFormat;
  /** The policy now; the code store opens only while `complexity.enabled` holds (D4). */
  readonly policy: () => Policy;
  readonly resultKey: ResultKeyOf;
  /** A path no record holds: Squeal's own provider, loaded by the workers. */
  readonly skip?: (path: AbsolutePath) => boolean;
  readonly now?: () => EpochMs;
  readonly log: (text: string) => void;
  readonly waitsMs?: readonly number[];
  /** How long a record retries a busy code store, by the clock; absent, `BUSY_BUDGET_MS`. */
  readonly busyMs?: number;
  /** Persists a note status lists (row 015-79): the drops by cause, bounded (`Drops`). */
  readonly note?: (text: string, topic: string) => void;
  /**
   * After each record is stored (row 015-12): the code pass judges CRAP
   * again. A throw is logged, never the writer's.
   */
  readonly onStored?: () => void;
  /**
   * The worker thread that maps payloads (row 015-42): absent, the script
   * beside the running code (`mapWorkerScript`); `null`, or none found, and
   * each payload is mapped on the main thread, paced.
   */
  readonly worker?: MapWorker | null;
  /** The main thread's share, shared with the coverage step (row 015-45); absent, its own. */
  readonly pace?: Pace;
}

/** Spec 015 D8: maps each payload and stores its record at its result's key. */
export interface CoverageWriter {
  /** A run's payloads; mapped one test file at a time, never awaited by the run. */
  collected(run: CoverageRun): void;
  /** Resolves once nothing is mapped or waits. */
  idle(): Promise<void>;
  /** A payload is queued or mapped, or a record waits for its result or the store (row 015-12). */
  busy(): boolean;
  /** The completed test files that got no record so far, by cause (row 015-79). */
  dropped(): Readonly<Partial<Record<DropCause, number>>>;
  /** Stops waiting, deletes the payloads not mapped yet and closes the code store. */
  close(): Promise<void>;
}

interface Job {
  readonly runId: string;
  readonly file: CoveredFile;
  record?: SharedRecord;
  /** Its result's key once found: a retry on a busy store stores there. */
  key?: CheckKey;
  /** The result waits it took. */
  attempt: number;
  /** When it first waited for a busy code store. */
  busySince?: EpochMs;
}

/**
 * Off the scheduler's path (D8): `collected` only queues. Each job is
 * mapped in the worker thread while one runs, then looks for its key at
 * each of `RESULT_WAITS_MS`. A job's main-thread time, its whole map
 * without a worker, is given back before the next starts (row 015-42). The
 * worker stops when the queue is empty; a failed one is told once, and the
 * rest is mapped here. The code store is opened at the first record and
 * kept. A write that meets a busy store waits at most `BUSY_SLICE_MS`; its
 * job keeps record and key and is retried after `busyBackoffMs`, paced, and
 * the jobs after it wait with it, so retries never stack (row 015-79).
 */
export function createCoverageWriter(options: CoverageWriterOptions): CoverageWriter {
  const now = options.now ?? Date.now;
  const waits = options.waitsMs ?? RESULT_WAITS_MS;
  const busyMs = options.busyMs ?? BUSY_BUDGET_MS;
  const blobs: BlobCache = new Map();
  const queue: Job[] = [];
  /** Jobs waiting for their result, by their timer. */
  const held = new Map<NodeJS.Timeout, Job>();
  /** Jobs whose record waits for a busy code store, the first to retry first. */
  const stalled: Job[] = [];
  let retry: NodeJS.Timeout | null = null;
  let retries = 0;
  const drops = new Drops(options.note);
  let store: CodeStore | null = null;
  let running: Promise<void> | null = null;
  let closed = false;
  let settle: (() => void) | null = null;
  let settled: Promise<void> | null = null;
  const pace = options.pace ?? new Pace(now);
  const script = mapWorkerScript();
  /** The worker that maps while one runs; `null` with none, or once one failed. */
  let worker: MapWorker | null =
    options.worker === undefined ? (script === null ? null : { script }) : options.worker;
  let mapper: Mapper | null = null;
  const mapping = { format: options.format, skip: options.skip ?? (() => false), pace };
  const mapperNow = (): Mapper => {
    if (mapper !== null) return mapper;
    const thread = worker;
    if (thread === null) return threadMapper(mapping, blobs);
    try {
      mapper = workerMapper(thread, mapping, (error) => failed(thread, error));
    } catch (error) {
      failed(thread, error);
      return threadMapper(mapping, blobs);
    }
    return mapper;
  };
  const mapOf = async (file: CoveredFile): Promise<SharedRecord> => {
    try {
      return await mapperNow().map(file);
    } catch (error) {
      // A job the worker did not answer for keeps its payload, for this thread (review 0.1.305 B2).
      if (closed || !existsSync(file.payload)) throw error;
      return threadMapper(mapping, blobs).map(file);
    }
  };
  const failed = (thread: MapWorker, error: unknown) => {
    if (worker !== thread) return;
    worker = null;
    mapper = null;
    options.log(
      `coverage: the mapping worker failed (${String(error)}); mapping on the main thread`,
    );
  };

  /** A completed test file that got no record: counted by cause, `why` logged; close notes the rest. */
  const drop = (job: Job, cause: DropCause, why?: string): void => {
    rmSync(job.file.payload, { force: true });
    if (why !== undefined) options.log(`coverage: ${job.file.testFile.path}: ${why}`);
    drops.count(cause, job.file.testFile.path, why, closed);
  };

  const open = (): CodeStore | CodeStoreOpenFailure => {
    if (store !== null) return store;
    const opened = openCodeStore(options.commonDir, options.policy());
    if (!isCodeStoreOpenFailure(opened)) store = opened;
    return opened;
  };
  /** Its record at its key; a busy store keeps both for a retry, never mapping it again. */
  const keep = (job: Job, key: CheckKey, record: SharedRecord): void => {
    let cause: DropCause = "store-open";
    try {
      const opened = open();
      if (isCodeStoreOpenFailure(opened)) {
        drop(job, cause, `the code store did not open: ${JSON.stringify(opened)}`);
        return;
      }
      cause = "store-error";
      const at = { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION };
      withBusySliceSync(BUSY_SLICE_MS, () => opened.coverage.putParts(at, record, now()));
    } catch (error) {
      if (isBusy(error)) stall(job);
      else drop(job, cause, String(error));
      return;
    }
    retries = 0;
    try {
      options.onStored?.();
    } catch (error) {
      options.log(`coverage: after storing ${job.file.testFile.path}: ${String(error)}`);
    }
  };
  /** Waits for the busy store's next retry, unless its budget is spent. */
  const stall = (job: Job): void => {
    job.busySince ??= now();
    const waited = now() - job.busySince;
    if (waited >= busyMs) {
      drop(job, "busy", `the code store stayed locked for ${Math.round(waited / 1000)} s`);
      return;
    }
    stalled.push(job);
    if (retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      queue.unshift(...stalled.splice(0));
      start();
    }, busyBackoffMs(retries++));
    retry.unref();
  };
  const later = (job: Job): void => {
    const wait = waits[job.attempt];
    if (wait === undefined) {
      options.log(`coverage: no result of run ${job.runId} for ${job.file.testFile.path}`);
      drop(job, "no-result");
      return;
    }
    const timer = setTimeout(() => {
      held.delete(timer);
      queue.push(job);
      start();
    }, wait);
    timer.unref();
    held.set(timer, job);
  };
  /** One paced unit: the job's key, kept once found, then its record, unless the store is busy. */
  const place = (job: Job, record: SharedRecord): void => {
    if (job.key === undefined) {
      job.attempt++;
      const key = options.resultKey(job.runId, job.file.testFile);
      if (key !== undefined) job.key = key;
    }
    if (job.key === undefined) later(job);
    // While a record waits for the store, the next waits with it: one retry, one slice.
    else if (stalled.length > 0) stall(job);
    else keep(job, job.key, record);
  };
  const step = async (job: Job): Promise<void> => {
    let record: SharedRecord;
    try {
      record = job.record ??= await mapOf(job.file);
    } catch (error) {
      drop(job, closed ? "closed" : "map-error", closed ? undefined : String(error));
      return;
    }
    if (closed) {
      drop(job, "closed");
      return;
    }
    try {
      pace.measure(() => place(job, record));
    } catch (error) {
      // Only the result's lookup throws here: `keep` takes its own.
      drop(job, "no-result", String(error));
    }
  };
  const loop = async () => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      // One test file at a time, once the one before, or a coverage step, had its time back.
      do await pace.wait();
      while (!closed && !pace.due());
      if (closed) {
        drop(job, "closed");
        break;
      }
      await step(job);
    }
    running = null;
    // The worker stops with the queue, so it holds no memory between runs.
    void mapper?.close();
    mapper = null;
    if (held.size === 0 && stalled.length === 0) settle?.();
  };
  const start = () => {
    running ??= loop();
  };

  return {
    collected(run) {
      for (const file of run.files) {
        const job = { runId: run.runId, file, attempt: 0 };
        if (closed) drop(job, "closed");
        else queue.push(job);
      }
      if (!closed) start();
    },
    busy: () => running !== null || held.size > 0 || stalled.length > 0 || queue.length > 0,
    dropped: () => drops.counts(),
    idle() {
      if (running === null && held.size === 0 && stalled.length === 0) return Promise.resolve();
      settled ??= new Promise<void>((resolve) => {
        settle = () => {
          settle = null;
          settled = null;
          resolve();
        };
      });
      return settled;
    },
    async close() {
      closed = true;
      for (const [timer, job] of held) {
        clearTimeout(timer);
        drop(job, "closed");
      }
      held.clear();
      if (retry !== null) clearTimeout(retry);
      retry = null;
      for (const job of stalled.splice(0)) drop(job, "closed");
      await mapper?.close();
      await running;
      for (const job of queue.splice(0)) drop(job, "closed");
      store?.close();
      store = null;
      drops.tell();
      settle?.();
    },
  };
}
