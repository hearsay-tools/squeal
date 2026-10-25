import { existsSync, rmSync } from "node:fs";
import type { ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, CheckKey, EpochMs, Policy } from "../../types/index.js";
import { type CodeStore, isCodeStoreOpenFailure, openCodeStore } from "../store/index.js";
import {
  type Mapper,
  type MapWorker,
  mapWorkerScript,
  threadMapper,
  workerMapper,
} from "./mapper.js";
import { Pace } from "./pace.js";
import { type BlobCache, COVERAGE_PROVIDER_VERSION } from "./record.js";
import type { CoverageRun, CoveredFile, ResultKeyOf } from "./types.js";

/**
 * How long a mapped record waits for its result to be stored: the scheduler
 * stores a run's results after its report, its checks and a rerun if any.
 * A result never stored under this run (withheld, a crash) drops its record.
 */
export const RESULT_WAITS_MS = [0, 250, 1_000, 5_000, 30_000] as const;

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
}

/** Spec 015 D8: maps each payload and stores its record at its result's key. */
export interface CoverageWriter {
  /** A run's payloads; mapped one test file at a time, never awaited by the run. */
  collected(run: CoverageRun): void;
  /** Resolves once nothing is mapped or waits. */
  idle(): Promise<void>;
  /** A payload is queued or mapped, or a record waits for its result (row 015-12). */
  busy(): boolean;
  /** Stops waiting, deletes the payloads not mapped yet and closes the code store. */
  close(): Promise<void>;
}

interface Job {
  readonly runId: string;
  readonly file: CoveredFile;
  record?: Uint8Array;
  attempt: number;
}

/**
 * Off the scheduler's path (D8): `collected` only queues. Each job is
 * mapped in the worker thread while one runs, then looks for its key at
 * each of `RESULT_WAITS_MS`. A job's main-thread time, its whole map
 * without a worker, is given back before the next starts (row 015-42). The
 * worker stops when the queue is empty; a failed one is told once, and the
 * rest is mapped here. The code store is opened at the first record and
 * kept.
 */
export function createCoverageWriter(options: CoverageWriterOptions): CoverageWriter {
  const now = options.now ?? Date.now;
  const waits = options.waitsMs ?? RESULT_WAITS_MS;
  const blobs: BlobCache = new Map();
  const queue: Job[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let store: CodeStore | null = null;
  let running: Promise<void> | null = null;
  let closed = false;
  let waiting = 0;
  let settle: (() => void) | null = null;
  let settled: Promise<void> | null = null;
  const pace = new Pace(now);
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
  const mapOf = async (file: CoveredFile): Promise<Uint8Array> => {
    const used = worker;
    try {
      return await mapperNow().map(file);
    } catch (error) {
      // A worker that failed before it read the payload leaves it to this thread.
      if (used === null || worker === used || closed || !existsSync(file.payload)) throw error;
      return mapperNow().map(file);
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

  const open = (): CodeStore | null => {
    if (store !== null) return store;
    const opened = openCodeStore(options.commonDir, options.policy());
    if (isCodeStoreOpenFailure(opened)) {
      options.log(`coverage: the code store did not open: ${JSON.stringify(opened)}`);
      return null;
    }
    store = opened;
    return store;
  };
  const keep = (job: Job, key: CheckKey): void => {
    const opened = open();
    if (opened === null || job.record === undefined) return;
    opened.coverage.put(
      { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION },
      job.record,
      now(),
    );
    try {
      options.onStored?.();
    } catch (error) {
      options.log(`coverage: after storing ${job.file.testFile.path}: ${String(error)}`);
    }
  };
  const later = (job: Job): void => {
    const wait = waits[job.attempt];
    if (wait === undefined) {
      options.log(`coverage: no result of run ${job.runId} for ${job.file.testFile.path}`);
      return;
    }
    waiting++;
    const timer = setTimeout(() => {
      timers.delete(timer);
      waiting--;
      if (closed) return;
      queue.push(job);
      start();
    }, wait);
    timer.unref();
    timers.add(timer);
  };
  const step = async (job: Job): Promise<void> => {
    try {
      job.record ??= await mapOf(job.file);
      if (closed) return;
      pace.measure(() => {
        const key = options.resultKey(job.runId, job.file.testFile);
        job.attempt++;
        if (key === undefined) later(job);
        else keep(job, key);
      });
    } catch (error) {
      rmSync(job.file.payload, { force: true });
      if (!closed) options.log(`coverage: ${job.file.testFile.path}: ${String(error)}`);
    }
  };
  const loop = async () => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      // One test file at a time, once the one before had its main-thread time back.
      await pace.wait();
      if (closed) {
        rmSync(job.file.payload, { force: true });
        break;
      }
      await step(job);
    }
    running = null;
    // The worker stops with the queue, so it holds no memory between runs.
    void mapper?.close();
    mapper = null;
    if (waiting === 0) settle?.();
  };
  const start = () => {
    running ??= loop();
  };

  return {
    collected(run) {
      if (closed) {
        for (const file of run.files) rmSync(file.payload, { force: true });
        return;
      }
      for (const file of run.files) queue.push({ runId: run.runId, file, attempt: 0 });
      start();
    },
    busy: () => running !== null || waiting > 0 || queue.length > 0,
    idle() {
      if (running === null && waiting === 0) return Promise.resolve();
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
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await mapper?.close();
      await running;
      for (const job of queue.splice(0)) rmSync(job.file.payload, { force: true });
      store?.close();
      store = null;
      settle?.();
    },
  };
}
