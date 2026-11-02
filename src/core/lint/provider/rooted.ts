import fs, { realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, resolve, sep } from "node:path";
import type { AbsolutePath } from "../../types/common.js";

/*
 * Rows 017-17 and 017-27: the ESLint worker runs from the project root, as
 * the CLI does. A worker cannot `chdir`, but its `process` is its own. So
 * `process.cwd()` returns the root, and each `fs` call resolves a relative
 * path against the root before the system takes it: the thread's own
 * directory is the daemon's. This module is the one owner of that
 * redirection. The observer's wraps (`wraps.ts`) sit above it, so they
 * still see the caller and the caller's path.
 */

/** An `fs` function, as this module wraps it. */
type Call = (this: unknown, ...args: unknown[]) => unknown;

/**
 * The path arguments of each `fs` function, by its name without `Sync`:
 * the callback, `Sync` and `fs.promises` forms alike. `symlink`'s target
 * stays as given: the system reads a relative target from the link's
 * folder, not from the process directory.
 */
export const PATH_ARGUMENTS: Readonly<Record<string, readonly number[]>> = {
  access: [0],
  appendFile: [0],
  chmod: [0],
  chown: [0],
  copyFile: [0, 1],
  cp: [0, 1],
  createReadStream: [0],
  createWriteStream: [0],
  exists: [0],
  lchmod: [0],
  lchown: [0],
  link: [0, 1],
  lstat: [0],
  lutimes: [0],
  mkdir: [0],
  mkdtemp: [0],
  mkdtempDisposable: [0],
  open: [0],
  openAsBlob: [0],
  opendir: [0],
  readFile: [0],
  readdir: [0],
  readlink: [0],
  realpath: [0],
  rename: [0, 1],
  rm: [0],
  rmdir: [0],
  stat: [0],
  statfs: [0],
  symlink: [1],
  truncate: [0],
  unlink: [0],
  unwatchFile: [0],
  utimes: [0],
  watch: [0],
  watchFile: [0],
  writeFile: [0],
};

/**
 * Makes this thread run from `root`: `process.cwd()` and every relative
 * path an `fs` function takes. Call once, before the observer and ESLint
 * load.
 */
export function runFromRoot(root: AbsolutePath): void {
  const directory = realpathSync(root);
  process.cwd = () => directory;
  rootFunctions(fs, fs.promises, directory);
  syncBuiltinESMExports();
}

/**
 * Wraps the path functions of `host`, as `fs`, and `promised`, as
 * `fs.promises`, by `PATH_ARGUMENTS`: a relative path resolves against
 * `directory`. A name `host` or `promised` lacks is left out.
 */
export function rootFunctions(host: object, promised: object, directory: string): void {
  for (const [name, at] of Object.entries(PATH_ARGUMENTS)) {
    const owned: [object, string][] = [
      [host, name],
      [host, `${name}Sync`],
      [promised, name],
    ];
    for (const [owner, key] of owned) {
      const original: unknown = Reflect.get(owner, key);
      if (typeof original === "function") {
        Reflect.set(owner, key, rootedCall(original as Call, at, directory));
      }
    }
  }
}

/** A relative path argument resolved against `directory`; any other argument as it is. */
export function rootedPath(path: unknown, directory: string): unknown {
  const text = Buffer.isBuffer(path) ? path.toString() : path;
  // An empty path is Node's own error, not the root.
  if (typeof text !== "string" || text === "" || isAbsolute(text)) return path;
  // A trailing separator still asks for a folder.
  return resolve(directory, text) + (text.endsWith(sep) ? sep : "");
}

/**
 * `original` with its arguments at `at` rooted; its own function
 * properties, as `realpathSync.native` and `exists`'s promisified form,
 * rooted alike. `made` closes a cycle: `fs.promises.opendir` is its own
 * promisified form.
 */
function rootedCall(
  original: Call,
  at: readonly number[],
  directory: string,
  made = new Map<Call, Call>(),
): Call {
  const known = made.get(original);
  if (known !== undefined) return known;
  const call = function (this: unknown, ...args: unknown[]) {
    for (const index of at) {
      if (index < args.length) args[index] = rootedPath(args[index], directory);
    }
    return Reflect.apply(original, this, args);
  };
  made.set(original, call);
  for (const [key, value] of ownProperties(original)) {
    const rooted =
      typeof value === "function" ? rootedCall(value as Call, at, directory, made) : value;
    Reflect.set(call, key, rooted);
  }
  return call;
}

/** A function's own properties, other than those every function has. */
function ownProperties(call: Call): [string | symbol, unknown][] {
  const common = new Set<string | symbol>(["length", "name", "prototype"]);
  return Reflect.ownKeys(call)
    .filter((key) => !common.has(key))
    .map((key) => [key, Reflect.get(call, key)]);
}
