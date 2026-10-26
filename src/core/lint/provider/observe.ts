import fs from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blobHash, type ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { LintHeld } from "../pass/provider.js";
import { keyPath } from "./loaded.js";
import { absolute, LOADER, OWN, wrapOpens, wrapReads, wrapWorkers } from "./wraps.js";

/*
 * Spec 017 D4 and wave 1.7: what the worker thread loaded and read, with the
 * blob of exactly the bytes each use took. A resolve hook, set before ESLint
 * loads, records every module the thread resolves; a load hook, each
 * module's bytes. jiti loads an `eslint.config.ts` and its imports without
 * Node's loader: it reads each with `fs.readFileSync` (review 0.1.348 B2).
 * TypeScript's service and rules read through it too, at any time, so every
 * read is hashed: the bytes the read returns, before any decoding.
 */

/**
 * A use of a path's bytes, by what holds them (wave 1.7 C1). A module stays
 * loaded for the thread's life; one loaded with a query, as ESLint loads a
 * config file, is replaced when that file loads again. A read is held by its
 * reader until it reads again; TypeScript's copy, until it reads the file or
 * is given its text.
 */
type Slot = "typescript" | "module" | "module?" | `read ${string}`;

const TYPESCRIPT = `${sep}node_modules${sep}typescript${sep}`;

export class Observer {
  /** Resolved module URLs and the file URLs of reads while a config loads, for `sortLoaded`. */
  readonly urls = new Set<string>();
  private readonly files = new Set<string>();
  private loads = 0;
  private readonly uses = new Map<RelativePath, Map<Slot, string>>();
  private readonly unobserved = new Set<RelativePath>();
  /** Paths whose uses changed since the last `delta`. */
  private readonly changed = new Set<RelativePath>();
  /** Inside a read: the file opens Node makes for it are the read's own (C3). */
  private reading = 0;
  /** The module loader's last read, for a load hook given text: the blob of its bytes. */
  private loaderRead: { readonly path: RelativePath; readonly blob: string } | null = null;
  /** What started a worker thread in this thread, as a reason names it; `null` while nothing did (wave 1.8). */
  private starter: string | null = null;
  /** Modules whose source the loader reads after the load hook. */
  private readonly pending = new Map<RelativePath, Slot>();

  private constructor(
    private readonly roots: readonly [AbsolutePath, ...AbsolutePath[]],
    private readonly format: ObjectFormat,
  ) {}

  /** Sets the hooks and the recorders in this thread; call once, before ESLint loads. */
  static install(root: AbsolutePath, format: ObjectFormat): Observer {
    const observer = new Observer([fs.realpathSync(root), root], format);
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        observer.module(result.url);
        return result;
      },
      load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        observer.loaded(url, result.source);
        return result;
      },
    });
    // jiti's file cache would add reads of its own; off, it reads the sources only.
    process.env.JITI_FS_CACHE = "false";
    wrapReads(observer);
    wrapOpens(observer);
    wrapWorkers(observer);
    syncBuiltinESMExports();
    return observer;
  }

  /** Runs `work`, a config load, with each file it reads recorded for `saw`. */
  async loading<T>(work: () => Promise<T>): Promise<T> {
    this.loads++;
    try {
      return await work();
    } finally {
      this.loads--;
    }
  }

  /** Whether the thread resolved or, loading a config, read `path`. */
  saw(path: string): boolean {
    return this.files.has(path);
  }

  module(url: string): void {
    this.urls.add(url);
    if (url.startsWith("file:")) this.files.add(fileURLToPath(url.split("?")[0] ?? url));
  }

  /** A module's source as the load hook got it: bytes, or the text of the loader's read. */
  loaded(url: string, source: unknown): void {
    const read = this.loaderRead;
    this.loaderRead = null;
    if (!url.startsWith("file:")) return;
    const query = url.indexOf("?");
    const path = keyPath(fileURLToPath(query < 0 ? url : url.slice(0, query)), this.roots);
    if (path === null) return;
    const slot = query < 0 ? "module" : "module?";
    if (source instanceof Uint8Array) this.use(path, slot, blobHash(source, this.format));
    else if (source instanceof ArrayBuffer) {
      this.use(path, slot, blobHash(new Uint8Array(source), this.format));
    } else if (typeof source === "string" && read?.path === path) this.use(path, slot, read.blob);
    else if (source === null || source === undefined) this.pending.set(path, slot);
    else this.unobserve(path);
  }

  /** `bytes`, read from `file` by code in `reader`. */
  read(file: AbsolutePath, bytes: Uint8Array, reader: string): void {
    if (this.loads > 0) {
      this.files.add(file);
      this.urls.add(pathToFileURL(file).href);
    }
    const path = keyPath(file, this.roots);
    if (path === null || OWN.has(reader)) return;
    const blob = blobHash(bytes, this.format);
    if (reader.startsWith(LOADER)) {
      this.loaderRead = { path, blob };
      const slot = this.pending.get(path);
      this.pending.delete(path);
      if (slot !== undefined) this.use(path, slot, blob);
    } else this.use(path, reader.includes(TYPESCRIPT) ? "typescript" : `read ${reader}`, blob);
  }

  /** TypeScript's service was given `path`'s text, whose blob the pass read as `blob`. */
  gave(path: RelativePath, blob: string): void {
    this.use(path, "typescript", blob);
  }

  /** ESLint code started a worker thread; `by` names it, `null` for the worker's own. */
  started(by: string | null): void {
    if (by !== null) this.starter ??= by;
  }

  /**
   * Why nothing this thread lints can be stored any more (wave 1.8): ESLint
   * code started a worker thread, whose reads the observer does not see.
   * `null` while none did; a new thread starts clean.
   */
  get blind(): string | null {
    if (this.starter === null) return null;
    return `ESLint ran code in a worker thread Squeal cannot observe (${this.starter})`;
  }

  /** A file opened to be read some other way than whole: its bytes cannot be hashed. */
  opened(file: unknown): void {
    if (this.reading > 0) return;
    const abs = absolute(file);
    const path = abs === null ? null : keyPath(abs, this.roots);
    if (path !== null) this.unobserve(path);
  }

  /** Each path whose uses changed since the last call, with what it holds now. */
  delta(): (readonly [RelativePath, LintHeld])[] {
    const out: (readonly [RelativePath, LintHeld])[] = [];
    for (const path of [...this.changed].sort()) out.push([path, this.heldOf(path)]);
    this.changed.clear();
    return out;
  }

  /** What the thread holds of `path`. */
  heldOf(path: RelativePath): LintHeld {
    const uses = this.uses.get(path) ?? new Map<Slot, string>();
    const typescript = uses.get("typescript");
    const others = [...new Set([...uses].flatMap(([s, b]) => (s === "typescript" ? [] : [b])))];
    return {
      ...(typescript === undefined ? {} : { typescript }),
      others: others.sort(),
      ...(this.unobserved.has(path) ? { unobserved: true as const } : {}),
    };
  }

  /** Runs `read` as one read: the opens it makes are its own. */
  inside<T>(read: () => T): T {
    this.reading++;
    try {
      return read();
    } finally {
      this.reading--;
    }
  }

  private use(path: RelativePath, slot: Slot, blob: string): void {
    let uses = this.uses.get(path);
    if (uses === undefined) {
      uses = new Map();
      this.uses.set(path, uses);
    }
    if (uses.get(slot) === blob) return;
    uses.set(slot, blob);
    this.changed.add(path);
  }

  private unobserve(path: RelativePath): void {
    if (this.unobserved.has(path)) return;
    this.unobserved.add(path);
    this.changed.add(path);
  }
}
