import fs from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import workerThreads from "node:worker_threads";
import type { AbsolutePath } from "../../types/common.js";
import type { Observer } from "./observe.js";

/*
 * Wave 1.7 and 1.8: the worker thread's file APIs, wrapped so that every
 * read reports its bytes to the observer and every other read-capable open
 * marks its path unobserved; and its worker threads, whose reads it does
 * not see.
 */

/** The module loader's code, as a stack names it. */
export const LOADER = "node:internal/modules/";
/** The worker's own code, as a stack names it: its reads are no use of ESLint's. */
export const OWN: ReadonlySet<string> = new Set([import.meta.url, fileURLToPath(import.meta.url)]);

/** A path argument as an absolute path; `null` for a file descriptor or a handle. */
export function absolute(path: unknown): AbsolutePath | null {
  if (path instanceof URL) return path.protocol === "file:" ? fileURLToPath(path) : null;
  const text = Buffer.isBuffer(path) ? path.toString() : path;
  if (typeof text !== "string") return null;
  return isAbsolute(text) ? text : resolve(text);
}

/** A function or class a stack is read above. */
type Below = NonNullable<Parameters<typeof Error.captureStackTrace>[1]>;

/** The `limit` innermost call sites above `below`. */
export function callSites(below: Below, limit: number): NodeJS.CallSite[] {
  const { prepareStackTrace, stackTraceLimit } = Error;
  const holder: { stack?: NodeJS.CallSite[] } = {};
  try {
    Error.prepareStackTrace = (_, sites) => sites;
    Error.stackTraceLimit = limit;
    Error.captureStackTrace(holder, below);
    return holder.stack ?? [];
  } finally {
    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }
}

/** The file of the code that called `below`. */
function callerOf(below: Below): string {
  return callSites(below, 1)[0]?.getFileName() ?? "";
}

/**
 * Whether Node's own `readFileSync` called `below` for the module loader:
 * Node 22.19's loader reads a module that way, and its open is that read's
 * own. The bytes reach the load hook (`loaded`).
 */
function loaderOpen(below: Below): boolean {
  const [read, caller] = callSites(below, 2);
  return (
    read?.getFileName() === "node:fs" &&
    read.getFunctionName() === "readFileSync" &&
    (caller?.getFileName() ?? "").startsWith(LOADER)
  );
}

/** A read's options without its encoding: the bytes come back raw (C2). */
function raw(options: unknown): unknown {
  if (options === null || typeof options !== "object") return undefined;
  const { encoding: _, ...rest } = options as Record<string, unknown>;
  return rest;
}

/** The read's result as the caller asked for it: its bytes decoded as Node decodes them. */
function decoded(bytes: Buffer, options: unknown): Buffer | string {
  const encoding =
    typeof options === "string" ? options : (options as { encoding?: unknown } | null)?.encoding;
  if (typeof encoding !== "string" || encoding === "buffer") return bytes;
  return bytes.toString(encoding as BufferEncoding);
}

/** `fs.readFileSync`, `fs.readFile` and `fs.promises.readFile` with each read's bytes hashed. */
export function wrapReads(observer: Observer): void {
  const { readFileSync, readFile } = fs;
  const readAsync = fs.promises.readFile;
  const sync = function (this: unknown, ...args: unknown[]) {
    const [path, options] = args;
    const file = absolute(path);
    if (file === null) return Reflect.apply(readFileSync, this, args);
    const reader = callerOf(sync);
    const bytes = observer.inside(() => Reflect.apply(readFileSync, this, [path, raw(options)]));
    observer.read(file, bytes, reader);
    return decoded(bytes, options);
  };
  const callback = function (this: unknown, ...args: unknown[]) {
    const [path, options] = args;
    const done = args.at(-1);
    const file = absolute(path);
    if (file === null || typeof done !== "function") return Reflect.apply(readFile, this, args);
    const reader = callerOf(callback);
    const given = args.length > 2 ? options : undefined;
    const back = (error: unknown, bytes: Buffer) => {
      if (error) return done(error);
      observer.read(file, bytes, reader);
      done(null, decoded(bytes, given));
    };
    return Reflect.apply(readFile, this, [path, raw(given), back]);
  };
  const promised = async function (this: unknown, ...args: unknown[]) {
    const [path, options] = args;
    const file = absolute(path);
    if (file === null) return Reflect.apply(readAsync, this, args);
    const reader = callerOf(promised);
    const bytes = await Reflect.apply(readAsync, this, [path, raw(options)]);
    observer.read(file, bytes, reader);
    return decoded(bytes, options);
  };
  fs.readFileSync = sync as typeof fs.readFileSync;
  fs.readFile = callback as typeof fs.readFile;
  fs.promises.readFile = promised as typeof fs.promises.readFile;
}

/** Node's string flags whose descriptor only writes; every other flag Node accepts reads. */
const WRITE_ONLY: ReadonlySet<string> = new Set(["w", "wx", "xw", "a", "ax", "xa", "as", "sa"]);

/**
 * Whether open flags read (review 0.1.353 B1-R4): any but write-only ones,
 * `a+`, `w+` and the other `+` forms among them. Flags Node refuses count
 * as a read: the open throws, and counting it costs nothing.
 */
export function reads(flags: unknown): boolean {
  if (flags === undefined || flags === null || typeof flags === "function") return true;
  if (typeof flags === "string") return !WRITE_ONLY.has(flags);
  // The two low bits are the access mode: read only, write only or both.
  return typeof flags === "number" && (flags & 3) !== fs.constants.O_WRONLY;
}

/**
 * Opens that read a file piecewise, as a stream or as a blob (wave 1.7 Q4,
 * wave 1.8): such a path is unobserved, and so is what is read through its
 * descriptor. `readFileSync` opens the file itself: that open is its own
 * read's (C3), the module loader's included.
 */
export function wrapOpens(observer: Observer): void {
  const { openSync, open, createReadStream, openAsBlob } = fs;
  const openAsync = fs.promises.open;
  const flagged = <F extends (...args: never[]) => unknown>(original: F) => {
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (reads(args[1]) && !loaderOpen(wrapped)) observer.opened(args[0]);
      return Reflect.apply(original, this, args);
    };
    return wrapped;
  };
  fs.openSync = flagged(openSync) as typeof fs.openSync;
  fs.open = flagged(open) as typeof fs.open;
  fs.promises.open = flagged(openAsync) as typeof fs.promises.open;
  fs.createReadStream = function (this: unknown, ...args: unknown[]) {
    observer.opened(args[0]);
    return Reflect.apply(createReadStream, this, args);
  } as typeof fs.createReadStream;
  fs.openAsBlob = function (this: unknown, ...args: unknown[]) {
    observer.opened(args[0]);
    return Reflect.apply(openAsBlob, this, args);
  } as typeof fs.openAsBlob;
}

/** Frames read for the code that started a worker thread. */
const STARTER_FRAMES = 32;
/** ESLint's own packages: a worker thread they start for a plugin is named by the plugin. */
const ESLINT = /^(eslint|eslint9|@eslint\/.+)$/;

/**
 * Worker threads ESLint code starts (wave 1.8, review 0.1.353): the
 * observer does not reach into them, as synckit's for eslint-plugin-prettier,
 * so the observer is told who started one.
 */
export function wrapWorkers(observer: Observer): void {
  const { Worker } = workerThreads;
  const Watched = class extends Worker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      observer.started(starterOf(callSites(Watched, STARTER_FRAMES)));
    }
  };
  workerThreads.Worker = Watched;
}

/**
 * The packages whose code started a worker thread, innermost first: two at
 * most, ESLint's own named only when no other code is; `null` when the
 * worker's own code started it.
 */
export function starterOf(sites: readonly NodeJS.CallSite[]): string | null {
  const names: string[] = [];
  let eslint: string | null = null;
  for (const site of sites) {
    const file = site.getFileName() ?? "";
    if (file === "" || file.startsWith("node:")) continue;
    if (OWN.has(file)) break;
    const name = packageOf(file);
    if (ESLINT.test(name)) eslint ??= name;
    else if (!names.includes(name)) names.push(name);
    if (names.length === 2) break;
  }
  return names.length > 0 ? names.join(", called by ") : eslint;
}

/** The package a file is in, by its last `node_modules` folder; a project file stands as its path. */
function packageOf(file: string): string {
  const path = file.startsWith("file:") ? fileURLToPath(file) : file;
  const parts = path.split(`${sep}node_modules${sep}`);
  if (parts.length < 2) return path;
  const [scope = path, name] = (parts.at(-1) ?? "").split(sep);
  return scope.startsWith("@") && name !== undefined ? `${scope}/${name}` : scope;
}
