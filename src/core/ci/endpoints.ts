import { performance } from "node:perf_hooks";
import { FILE_CONCURRENCY } from "../fs/concurrency.js";
import { hashFile, type ObjectFormat } from "../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { hashInChild } from "./endpoints-child.js";
import {
  type Clock,
  type EndHashes,
  type EndWork,
  hashEnd,
  type ReadFile,
} from "./endpoints-hash.js";
import type { InputEvidence } from "./inputs.js";
import { ownMap } from "./own-map.js";

/*
 * Spec 018 D30 and D32 (row 018-57): `squeal ci record` hashes the checkout
 * in its own process before it starts the command and after the command
 * exited, as a key holds each path (`hereOf`): a file by its blob id
 * (`null`: no file), a listing path by the names on disk. It hashes every
 * path `HEAD`'s tree holds, each file and the listing of each directory,
 * also when the path is gone from the disk: only a path the commit holds can
 * be certified by its hashes (D33.3), and the export reads such a path that
 * is in neither `stable` nor `unstable` as the commit's content at both
 * ends. One `git ls-tree` before the command; no `git status`, no program
 * after it. A path git does not track is not hashed.
 *
 * Row 018-61 (review 0.1.582 S1, D20.2): each end has a time limit, so a
 * stalled read cannot hold the command back until an outer CI timeout stops
 * the step. An end gives up when the time since it began passes
 * `max(floor, multiple × projected)`, `projected` being the time its hashing
 * takes for all its paths at the rate measured so far (paths hashed per
 * millisecond since the hashing began, at the last path that finished). The
 * rate counts once as many paths as are read at once (`FILE_CONCURRENCY`),
 * or all of them, are hashed; before that the floor alone holds. A stalled
 * read stops the count, so the projection, and with it the limit, stops
 * growing. Past the limit the end reads no further path and gives its
 * reason: the part has no endpoint hashes, and the export keeps D9 alone.
 *
 * Row 018-67 (review 0.1.585 S1): in `ci record`, each end runs in a child
 * process (`endpoints-child.ts`), killed past the limit, so a read that
 * never ends holds that child and not `ci record`'s process.
 */

/** When one end's hashing gives up (row 018-61): `max(floorMs, multiple × projected)`. */
export interface HashingLimit {
  readonly floorMs: number;
  readonly multiple: number;
}

/**
 * 10 s: ten times the 1 s cezar's 4,967 tracked files took per end at a
 * host load of about 40 (D30), and well inside any CI step's timeout; 4×:
 * room for a cache-cold read of the files the rate was measured on.
 */
export const HASHING_LIMIT: HashingLimit = { floorMs: 10_000, multiple: 4 };

/** How `endpointsBefore` and `endpointsAfter` read; tests give a small limit and a stalled read. */
export interface EndpointsOptions {
  readonly limit?: HashingLimit;
  /**
   * The command that starts this CLI again (`CliIo.relaunch`). Row 018-67:
   * each end then hashes in a child process of it, killed past the limit,
   * so a read the operating system never ends cannot hold this process
   * open. Without it, each end hashes in this process.
   */
  readonly relaunch?: readonly string[];
  /** A file's blob id (`null`: no file), in this process only; default `hashFile`. */
  readonly hashFile?: ReadFile;
}

/** What the hashes before the command hold, for `endpointsAfter`. */
export interface EndpointsBefore {
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
  readonly commit: string;
  readonly paths: readonly RelativePath[];
  /** Each path's hash at the commit (`atCommit`), by `paths`' index. */
  readonly committed: readonly (FileHash | null)[];
  readonly hashes: readonly (FileHash | null)[];
  readonly ms: number;
  readonly options: EndpointsOptions;
}

/** A format 6 part's endpoint fields (`Part.stable`, `Part.unstable`), and the time both ends took. */
export interface Endpoints {
  readonly stable: InputEvidence;
  readonly unstable: readonly RelativePath[];
  readonly ms: number;
}

/** The hashes of `root` before the command; why none when it has no commit or passed its limit. */
export async function endpointsBefore(
  root: AbsolutePath,
  format: ObjectFormat,
  options: EndpointsOptions = {},
): Promise<EndpointsBefore | string> {
  const start = performance.now();
  const end = await endOf({ root, format, commit: null }, options);
  if (typeof end === "string") return end;
  const { commit, paths, committed = [], hashes } = end;
  return { root, format, commit, paths, committed, hashes, ms: performance.now() - start, options };
}

/**
 * The hashes after the command, against `before`: `stable` holds each path
 * whose two hashes are equal and differ from the commit (`atCommit`), with
 * that hash; `unstable` each path whose two hashes differ. Why none when
 * `HEAD` moved during the command: the part names another commit.
 */
export async function endpointsAfter(before: EndpointsBefore): Promise<Endpoints | string> {
  const start = performance.now();
  const { root, format, commit, paths, committed, hashes, options } = before;
  const end = await endOf({ root, format, commit, paths }, options);
  if (typeof end === "string") return end;
  const stable: [RelativePath, FileHash | null][] = [];
  const unstable: RelativePath[] = [];
  paths.forEach((path, index) => {
    const hash = hashes[index] ?? null;
    if (hash !== (end.hashes[index] ?? null)) unstable.push(path);
    else if (hash !== (committed[index] ?? null)) stable.push([path, hash]);
  });
  return {
    stable: ownMap(stable),
    unstable,
    ms: before.ms + performance.now() - start,
  };
}

/** One end under its limit, in a child of `options.relaunch` or in this process. */
function endOf(work: EndWork, options: EndpointsOptions): Promise<EndHashes | string> {
  const { relaunch } = options;
  const read = options.hashFile ?? hashFile;
  return limited(options.limit ?? HASHING_LIMIT, (clock, stop) =>
    relaunch === undefined ? hashEnd(work, read, clock) : hashInChild(relaunch, work, clock, stop),
  );
}

/**
 * `work` under `limit` (row 018-61): its result, or why it gave up once the
 * time since it began passed the limit. Past the limit, `work` reads no
 * further path, and `stop` aborts: a child doing it is killed (row 018-67).
 * In this process, a read already started is left to end on its own.
 */
function limited<T>(
  limit: HashingLimit,
  work: (clock: Clock, stop: AbortSignal) => Promise<T>,
): Promise<T | string> {
  const start = performance.now();
  const stop = new AbortController();
  let total = 0;
  let begun = 0;
  let done = 0;
  let lastDone = 0;
  const allowed = () => {
    const measured = done > 0 && done >= Math.min(FILE_CONCURRENCY, total);
    const projected = measured ? ((lastDone - begun) * total) / done : 0;
    return Math.max(limit.floorMs, limit.multiple * projected);
  };
  const clock = {
    over: false,
    begin(count: number) {
      total = count;
      begun = performance.now();
    },
    hashed(count: number) {
      done += count;
      lastDone = performance.now();
    },
  };
  return new Promise<T | string>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const check = () => {
      const left = allowed() - (performance.now() - start);
      if (left > 0) {
        timer = setTimeout(check, left);
        return;
      }
      clock.over = true;
      const seconds = (allowed() / 1000).toFixed(1);
      const progress = begun === 0 ? "before it listed the paths" : `${done} of ${total} paths`;
      resolve(`hashing the checkout passed its limit of ${seconds} s (${progress})`);
      stop.abort();
    };
    timer = setTimeout(check, limit.floorMs);
    work(clock, stop.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
