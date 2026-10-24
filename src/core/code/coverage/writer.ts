import { readFileSync, rmSync } from "node:fs";
import type { ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, CheckKey, EpochMs, Policy } from "../../types/index.js";
import { type CodeStore, isCodeStoreOpenFailure, openCodeStore } from "../store/index.js";
import { type BlobCache, buildRecord, COVERAGE_PROVIDER_VERSION, encodeRecord } from "./record.js";
import type { CoverageRun, CoveredFile, ResultKeyOf, V8Script } from "./types.js";

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
}

/** Spec 015 D8: maps each payload and stores its record at its result's key. */
export interface CoverageWriter {
  /** A run's payloads; mapped one test file per turn of the event loop, never awaited by the run. */
  collected(run: CoverageRun): void;
  /** Resolves once nothing is mapped or waits. */
  idle(): Promise<void>;
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
 * mapped in a turn of its own, then looks for its key at each of
 * `RESULT_WAITS_MS`. The code store is opened at the first record and kept.
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
  const map = (job: Job): void => {
    let payload: readonly V8Script[];
    try {
      payload = (JSON.parse(readFileSync(job.file.payload, "utf8")) as { result: V8Script[] })
        .result;
    } finally {
      rmSync(job.file.payload, { force: true });
    }
    job.record = encodeRecord(buildRecord(job.file, payload, options.format, blobs, options.skip));
  };
  const keep = (job: Job, key: CheckKey): void => {
    const opened = open();
    if (opened === null || job.record === undefined) return;
    opened.coverage.put(
      { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION },
      job.record,
      now(),
    );
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
  const step = (job: Job): void => {
    try {
      if (job.record === undefined) map(job);
      const key = options.resultKey(job.runId, job.file.testFile);
      job.attempt++;
      if (key === undefined) later(job);
      else keep(job, key);
    } catch (error) {
      options.log(`coverage: ${job.file.testFile.path}: ${String(error)}`);
    }
  };
  const loop = async () => {
    for (let job = queue.shift(); job !== undefined && !closed; job = queue.shift()) {
      // One test file per turn: hooks and the scheduler run between them.
      await new Promise((resolve) => setImmediate(resolve));
      if (!closed) step(job);
    }
    running = null;
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
      await running;
      for (const job of queue.splice(0)) rmSync(job.file.payload, { force: true });
      store?.close();
      store = null;
      settle?.();
    },
  };
}
