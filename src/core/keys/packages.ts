import { type Dirent, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { compare, isRecord } from "../fs/index.js";
import type { AbsolutePath, PackageImport, RelativePath } from "../types/index.js";

/**
 * Builtins through which a test can load packages no import names: a child
 * process, a worker thread, `createRequire` and `require.resolve`. Spec 001
 * D3 (task 001-105): a closure that imports one keys by the whole
 * installed-dependency fingerprint. `cluster` forks like `child_process`.
 */
export const OPAQUE_BUILTINS: ReadonlySet<string> = new Set([
  "child_process",
  "cluster",
  "module",
  "worker_threads",
]);

/** The `packages` entry of npm's hidden lockfile, as far as a key reads it. */
interface LockEntry {
  readonly version?: unknown;
  readonly integrity?: unknown;
  readonly resolved?: unknown;
  readonly link?: unknown;
  readonly dependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

const EDGES = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

/**
 * Files a package can ship without anything Node loads: declarations, their
 * maps, the manifest and documentation. Anything else counts as runtime,
 * `.json` and `.ts` included, since a test can `require` the one and Vite
 * transforms the other.
 */
const NOT_RUNTIME = [
  /\.d\.[cm]?ts(?:\.map)?$/,
  /^package\.json$/,
  /\.(?:md|markdown|txt)$/i,
  /^(?:licen[cs]e|readme|changelog|notice|authors|history|copying)(?:[.-].*)?$/i,
];

/**
 * The installed npm dependency graph of one install, from its hidden
 * lockfile `node_modules/.package-lock.json`.
 *
 * Spec 001 D3 (task 001-105, `research/per-package-keys.md` F2): a package
 * is found as Node finds it, `<from>/node_modules/<name>` then each parent
 * directory's, closed over `dependencies`, `optionalDependencies` and
 * `peerDependencies`, and keyed as `location@version#integrity`. A name that
 * does not resolve keys as absent; a workspace link keys as its location,
 * since its files are project files in the closure; a package with no
 * runtime file keys as a constant and is not expanded, since it changes what
 * `tsc` reads, never what Node loads.
 */
export class InstalledGraph {
  readonly #packages: Readonly<Record<string, LockEntry>>;
  readonly #closures = new Map<string, readonly string[]>();

  /**
   * `base` is the directory holding `node_modules`, relative to the worktree
   * root (`""` for the root). `typesOnly` caches the on-disk scan by
   * identity, so a re-read of an unchanged install scans nothing.
   */
  constructor(
    readonly dir: AbsolutePath,
    readonly base: RelativePath,
    packages: Readonly<Record<string, unknown>>,
    private readonly typesOnly: Map<string, boolean> = new Map(),
  ) {
    const entries: Record<string, LockEntry> = {};
    for (const [location, entry] of Object.entries(packages)) {
      if (isRecord(entry)) entries[location] = entry;
    }
    this.#packages = entries;
  }

  /**
   * The sorted identities of every installed package `imports` can load,
   * without those in `exclude`.
   */
  identities(imports: readonly PackageImport[], exclude?: ReadonlySet<string>): string[] {
    const found = new Set<string>();
    const starts = new Set<string>();
    for (const { from, name } of imports) {
      const local = this.#local(from);
      const location = local === null ? null : this.#resolve(local, name);
      if (location === null) found.add(absent(local ?? from, name));
      else starts.add(location);
    }
    for (const location of starts) {
      for (const identity of this.#closure(location)) found.add(identity);
    }
    const sorted = [...found].filter((identity) => !exclude?.has(identity));
    return sorted.sort(compare);
  }

  /** A worktree-relative directory relative to the install, or `null` when outside it. */
  #local(from: RelativePath): string | null {
    if (this.base === "") return from;
    if (from === this.base) return "";
    return from.startsWith(`${this.base}/`) ? from.slice(this.base.length + 1) : null;
  }

  /** The location of `name` looked up from `from`, a link followed to its target. */
  #resolve(from: string, name: string): string | null {
    for (let dir = from; ; dir = parent(dir)) {
      if (!dir.endsWith("node_modules")) {
        const location = dir === "" ? `node_modules/${name}` : `${dir}/node_modules/${name}`;
        const entry = this.#packages[location];
        if (entry !== undefined) {
          return entry.link === true && typeof entry.resolved === "string"
            ? entry.resolved
            : location;
        }
      }
      if (dir === "") return null;
    }
  }

  /** Identities of `start` and everything it can load, memoized per location. */
  #closure(start: string): readonly string[] {
    const memo = this.#closures.get(start);
    if (memo !== undefined) return memo;
    const identities: string[] = [];
    const seen = new Set<string>();
    const stack = [start];
    for (let location = stack.pop(); location !== undefined; location = stack.pop()) {
      if (seen.has(location)) continue;
      seen.add(location);
      const entry = this.#packages[location];
      if (entry === undefined || !isInstalled(location)) {
        identities.push(`workspace:${location}`);
        continue;
      }
      if (this.#typesOnly(location, entry)) {
        identities.push(`${location}@types-only`);
        continue;
      }
      identities.push(
        `${location}@${text(entry.version)}#${text(entry.integrity ?? entry.resolved)}`,
      );
      for (const field of EDGES) {
        const names = entry[field];
        if (!isRecord(names)) continue;
        for (const name of Object.keys(names)) {
          const target = this.#resolve(location, name);
          if (target === null) identities.push(absent(location, name));
          else stack.push(target);
        }
      }
    }
    this.#closures.set(start, identities);
    return identities;
  }

  #typesOnly(location: string, entry: LockEntry): boolean {
    const id = `${this.dir}\0${location}\0${text(entry.version)}\0${text(entry.integrity)}`;
    let known = this.typesOnly.get(id);
    if (known === undefined) {
      known = !hasRuntimeFile(join(this.dir, location));
      this.typesOnly.set(id, known);
    }
    return known;
  }
}

/** Whether a package folder ships a file Node could load. Unreadable counts as yes. */
function hasRuntimeFile(dir: AbsolutePath): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  return entries.some((entry) => {
    if (entry.name === "node_modules") return false;
    if (entry.isDirectory()) return hasRuntimeFile(join(dir, entry.name));
    return !NOT_RUNTIME.some((pattern) => pattern.test(entry.name));
  });
}

/** A location under some `node_modules`: an installed package, not a workspace. */
function isInstalled(location: string): boolean {
  return location.startsWith("node_modules/") || location.includes("/node_modules/");
}

function absent(from: string, name: string): string {
  return `absent:${from}>${name}`;
}

function parent(dir: string): string {
  const up = posix.dirname(dir);
  return up === "." ? "" : up;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
