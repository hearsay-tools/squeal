import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import { ownRecord } from "./own.js";
import type { Pace } from "./pace.js";
import { type SharedRecord, shareRecord } from "./parts.js";
import {
  type BlobCache,
  buildRecord,
  COVERAGE_RECORD_VERSION,
  encodeRecord,
  mergeRecords,
} from "./record.js";
import type {
  ChildCoverage,
  CoverageRecord,
  CoveredFile,
  ExecutedSource,
  V8Payload,
} from "./types.js";

/**
 * Maps a test file's payload to its record as parts, hashed and compressed
 * (row 015-85), and deletes the payload once read; a map that fails before
 * its payload was read leaves it.
 */
export interface Mapper {
  map(file: CoveredFile): Promise<SharedRecord>;
  close(): Promise<void>;
}

export interface MapperOptions {
  readonly format: ObjectFormat;
  /** A path no record holds: Squeal's own provider. */
  readonly skip: (path: AbsolutePath) => boolean;
  /** Counts the main thread's share of each map. */
  readonly pace: Pace;
  /** Spec 020 D12: a child file of `testFile` was dropped alone, and why. */
  readonly childDropped?: (testFile: TestFileRef, why: string) => void;
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
      /** Row 015-86: `CoveredFile.ownRoot`; the worker then asks for no source. */
      readonly ownRoot?: AbsolutePath;
      /** Spec 020 D12: `CoveredFile.children`, read by the worker and removed by the main thread. */
      readonly children?: ChildCoverage;
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
  | {
      readonly type: "record";
      readonly id: number;
      readonly record: SharedRecord;
      /** Spec 020 D12: why each child file dropped alone was. */
      readonly dropped?: readonly string[];
    }
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

/**
 * Row 015-11's mapping, on this thread, encoded whole: the payload's read,
 * parse and map are its own, and its children's (spec 020 D12), each
 * dropped one told to `dropped`.
 */
export function mapHere(
  file: CoveredFile,
  format: ObjectFormat,
  blobs: BlobCache,
  skip: (path: AbsolutePath) => boolean,
  dropped?: (why: string) => void,
): Uint8Array {
  return encodeRecord(recordHere(file, format, blobs, skip, dropped));
}

/** On the main thread, each map, its parts' hashes and compression one unit of `pace`. */
export function threadMapper(options: MapperOptions, blobs: BlobCache): Mapper {
  return {
    map: async (file) =>
      options.pace.measure(() => {
        const dropped = (why: string) => options.childDropped?.(file.testFile, why);
        const record = recordHere(file, options.format, blobs, options.skip, dropped);
        return shareRecord(record, COVERAGE_RECORD_VERSION);
      }),
    close: () => Promise.resolve(),
  };
}

function recordHere(
  file: CoveredFile,
  format: ObjectFormat,
  blobs: BlobCache,
  skip: (path: AbsolutePath) => boolean,
  dropped: ((why: string) => void) | undefined,
): CoverageRecord {
  try {
    const payload = JSON.parse(readFileSync(file.payload, "utf8")) as V8Payload;
    const own =
      file.ownRoot === undefined
        ? buildRecord(file, payload.result, format, blobs, skip)
        : ownRecord(file.ownRoot, payload, format, skip);
    const merged = withChildren(own, file.children, format, skip);
    for (const why of merged.dropped) dropped?.(why);
    return merged.record;
  } finally {
    removePayload(file);
  }
}

/** Spec 020 D12: a larger child file is dropped unread (the coordinator's cap; V8's is ~512 MB). */
export const CHILD_FILE_LIMIT = 64 * 1024 * 1024;

/**
 * Spec 020 D12: `own` merged with each child file's record (`ownRecord`). A
 * file over the limit, or one that does not parse or map, is dropped alone,
 * with its reason: lost children only lower coverage.
 */
export function withChildren(
  own: CoverageRecord,
  children: ChildCoverage | undefined,
  format: ObjectFormat,
  skip: (path: AbsolutePath) => boolean = () => false,
): { readonly record: CoverageRecord; readonly dropped: readonly string[] } {
  if (children === undefined || !existsSync(children.dir)) return { record: own, dropped: [] };
  const records: CoverageRecord[] = [];
  const dropped: string[] = [];
  for (const name of readdirSync(children.dir).sort()) {
    const path = join(children.dir, name);
    try {
      const { size } = statSync(path);
      if (size > CHILD_FILE_LIMIT) {
        dropped.push(`${name}: over 64 MiB (${size} bytes)`);
        continue;
      }
      const payload = JSON.parse(readFileSync(path, "utf8")) as V8Payload;
      records.push(ownRecord(children.root, payload, format, skip));
    } catch (error) {
      dropped.push(`${name}: ${String(error)}`);
    }
  }
  return { record: mergeRecords(own, records), dropped };
}

/** Deletes a mapped file's payload and its children's directory. */
function removePayload(file: CoveredFile): void {
  rmSync(file.payload, { force: true });
  if (file.children !== undefined) rmSync(file.children.dir, { recursive: true, force: true });
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
    { file: CoveredFile; resolve(r: SharedRecord): void; reject(e: Error): void }
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
    removePayload(job.file);
    if (message.type === "error") {
      job.reject(new Error(message.message));
      return;
    }
    for (const why of message.dropped ?? []) options.childDropped?.(job.file.testFile, why);
    job.resolve(message.record);
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
          post({
            type: "job",
            id,
            sources,
            testFile: file.testFile,
            payload: file.payload,
            ...(file.ownRoot === undefined ? {} : { ownRoot: file.ownRoot }),
            ...(file.children === undefined ? {} : { children: file.children }),
          }),
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
