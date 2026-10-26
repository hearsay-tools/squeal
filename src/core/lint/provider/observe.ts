import fs from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Spec 017 D4: what the config loaded, as the worker thread sees it. A
 * resolve hook, set before ESLint loads, records every module the thread
 * resolves, as the observed-inputs recorder does. jiti loads an
 * `eslint.config.ts` and the modules it imports without Node's resolver:
 * it reads each with `fs.readFileSync`. So every file read while a config
 * loads counts too (review 0.1.348 B2).
 */

export class Observer {
  /** Resolved module URLs and the file URLs of reads, for `sortLoaded`. */
  readonly urls = new Set<string>();
  private readonly files = new Set<string>();
  private loads = 0;

  /** Sets the hook and the recorder in this thread; call once, before ESLint loads. */
  static install(): Observer {
    const observer = new Observer();
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        observer.module(result.url);
        return result;
      },
    });
    // jiti's file cache would add reads of its own; off, it reads the sources only.
    process.env.JITI_FS_CACHE = "false";
    const { readFileSync } = fs;
    fs.readFileSync = function (this: unknown, path: unknown, ...rest: unknown[]) {
      observer.read(path);
      return Reflect.apply(readFileSync, this, [path, ...rest]);
    } as typeof fs.readFileSync;
    return observer;
  }

  /** Runs `work`, a config load, with each file it reads recorded. */
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

  read(path: unknown): void {
    if (this.loads === 0) return;
    const file = path instanceof URL && path.protocol === "file:" ? fileURLToPath(path) : path;
    if (typeof file !== "string" || !isAbsolute(file)) return;
    this.files.add(file);
    this.urls.add(pathToFileURL(file).href);
  }
}
