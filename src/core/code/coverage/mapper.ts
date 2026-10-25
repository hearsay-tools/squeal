import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, TestFileRef } from "../../types/index.js";
import type { Pace } from "./pace.js";
import { type BlobCache, buildRecord, encodeRecord } from "./record.js";
import type { CoveredFile, ExecutedSource, V8Script } from "./types.js";

/**
 * Maps a test file's payload to its encoded record and deletes the payload
 * once read; a map that fails before its payload was read leaves it.
 */
export interface Mapper {
  map(file: CoveredFile): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface MapperOptions {
  readonly format: ObjectFormat;
  /** A path no record holds: Squeal's own provider. */
  readonly skip: (path: AbsolutePath) => boolean;
  /** Counts the main thread's share of each map. */
  readonly pace: Pace;
}

/** The worker script and the Node options that load it. */
export interface MapWorker {
  readonly script: string;
  readonly execArgv?: readonly string[];
}

/** To the worker: a payload to map, then the sources it asked for. */
export type ToWorker =
  | {
      readonly type: "job";
      readonly id: number;
      /** The main thread's number for the run's sources, which the worker keeps. */
      readonly sources: number;
      readonly testFile: TestFileRef;
      readonly payload: AbsolutePath;
    }
  | {
      readonly type: "sources";
      readonly id: number;
      readonly sources: number;
      readonly given: readonly (readonly [AbsolutePath, ExecutedSource])[];
      readonly absent: readonly AbsolutePath[];
    };

/** From the worker: the sources a payload needs, then its record or why it has none. */
export type FromWorker =
  | { readonly type: "need"; readonly id: number; readonly paths: readonly AbsolutePath[] }
  | { readonly type: "record"; readonly id: number; readonly record: Uint8Array }
  | { readonly type: "error"; readonly id: number; readonly message: string };

/**
 * Row 015-42: the worker script beside the running code. From a bundled
 * CLI at `<plugin>/dist/cli/`, `coverage-map.mjs` beside it; from `tsc`'s
 * build, `map-worker.js` beside this module. `null` from the TypeScript
 * sources, which map on the main thread.
 */
export function mapWorkerScript(module: URL = new URL(import.meta.url)): string | null {
  for (const name of ["./map-worker.js", "./coverage-map.mjs"]) {
    const script = fileURLToPath(new URL(name, module));
    if (existsSync(script)) return script;
  }
  return null;
}

/** Row 015-11's mapping, on this thread: the payload's read, parse and map are its own. */
export function mapHere(
  file: CoveredFile,
  format: ObjectFormat,
  blobs: BlobCache,
  skip: (path: AbsolutePath) => boolean,
): Uint8Array {
  let payload: readonly V8Script[];
  try {
    payload = (JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] }).result;
  } finally {
    rmSync(file.payload, { force: true });
  }
  return encodeRecord(buildRecord(file, payload, format, blobs, skip));
}

/** On the main thread, each map one unit of `pace`. */
export function threadMapper(options: MapperOptions, blobs: BlobCache): Mapper {
  return {
    map: async (file) =>
      options.pace.measure(() => mapHere(file, options.format, blobs, options.skip)),
    close: () => Promise.resolve(),
  };
}

/**
 * In a worker thread: the main thread posts each payload's path, gives the
 * sources it is asked for, and deletes the payload once the worker answered
 * for it. `onFailure` once when the worker fails; every map in hand and
 * after rejects, and leaves its payload (review 0.1.305 B2).
 */
export function workerMapper(
  worker: MapWorker,
  options: MapperOptions,
  onFailure: (error: Error) => void,
): Mapper {
  const thread = new Worker(worker.script, {
    workerData: { format: options.format },
    ...(worker.execArgv === undefined ? {} : { execArgv: [...worker.execArgv] }),
  });
  thread.unref();
  const ids = new WeakMap<ReadonlyMap<AbsolutePath, ExecutedSource>, number>();
  const jobs = new Map<
    number,
    { file: CoveredFile; resolve(r: Uint8Array): void; reject(e: Error): void }
  >();
  let jobsMade = 0;
  let runsMade = 0;
  let failed: Error | null = null;
  const idOf = (sources: ReadonlyMap<AbsolutePath, ExecutedSource>) => {
    const known = ids.get(sources) ?? runsMade++;
    ids.set(sources, known);
    return known;
  };
  const fail = (error: Error, told: boolean) => {
    if (failed !== null) return;
    failed = error;
    for (const job of jobs.values()) job.reject(error);
    jobs.clear();
    if (told) onFailure(error);
  };
  const answer = (message: FromWorker) => {
    const job = jobs.get(message.id);
    if (job === undefined) return;
    if (message.type === "need") {
      const given: [AbsolutePath, ExecutedSource][] = [];
      const absent: AbsolutePath[] = [];
      for (const path of message.paths) {
        const source = options.skip(path) ? undefined : job.file.sources.get(path);
        if (source === undefined) absent.push(path);
        else given.push([path, plain(source)]);
      }
      const sources = idOf(job.file.sources);
      post({ type: "sources", id: message.id, sources, given, absent });
      return;
    }
    jobs.delete(message.id);
    rmSync(job.file.payload, { force: true });
    if (message.type === "record") job.resolve(message.record);
    else job.reject(new Error(message.message));
  };
  const post = (message: ToWorker) => thread.postMessage(message);
  thread.on("message", (message: FromWorker) => {
    try {
      options.pace.measure(() => answer(message));
    } catch (error) {
      // A source the worker cannot take fails its job, never the daemon.
      const job = jobs.get(message.id);
      jobs.delete(message.id);
      job?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  thread.on("error", (error) => fail(error, true));
  thread.on("exit", (code) =>
    fail(new Error(`the coverage worker exited with code ${code}`), true),
  );
  return {
    map(file) {
      if (failed !== null) return Promise.reject(failed);
      const id = jobsMade++;
      return new Promise((resolve, reject) => {
        jobs.set(id, { file, resolve, reject });
        const sources = idOf(file.sources);
        options.pace.measure(() =>
          post({ type: "job", id, sources, testFile: file.testFile, payload: file.payload }),
        );
      });
    },
    async close() {
      fail(new Error("the records' writer closed"), false);
      await thread.terminate();
    },
  };
}

/** What the mapping reads of a source, with no class or function a worker cannot take. */
function plain(source: ExecutedSource): ExecutedSource {
  const map = source.map;
  return {
    path: source.path,
    code: source.code,
    map:
      map === null ? null : { mappings: map.mappings, sourcesContent: map.sourcesContent ?? null },
    sha1: source.sha1,
  };
}
