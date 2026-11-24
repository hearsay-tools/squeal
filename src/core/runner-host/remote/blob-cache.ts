import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { compare } from "../../fs/compare.js";
import { isMissing } from "../../fs/errors.js";
import { RACY_WINDOW_MS } from "../../hash/stat-cache.js";
import { installedDependencies, isInstalledLockfile } from "../../keys/environment.js";
import {
  HIDDEN_LOCKFILE,
  parseHiddenLockfile,
  staleHiddenLockfile,
} from "../../keys/hidden-lockfile.js";
import { PnpmGraph } from "../../keys/pnpm-graph.js";
import { stalePnpmLockfile } from "../../keys/pnpm-install.js";
import { PNPM_LOCKFILE } from "../../keys/pnpm-lockfile.js";
import type { AbsolutePath } from "../../types/common.js";
import { LOCKFILES } from "./tree-install.js";
import { insideRoot, treeBlob } from "./tree-wire.js";

/*
 * Stat-cached local blob and installed-dependency lookups for remote lanes.
 *
 * Every remote tier proves 500–1,300+ closure paths before and after execution
 * and compares the local installed-dependency fingerprint. Re-reading and
 * SHA-1 hashing every file on disk and re-parsing `node_modules/.pnpm/lock.yaml`
 * on every tier accounted for hundreds of milliseconds of local daemon CPU per
 * tier. Both caches enforce the `RACY_WINDOW_MS` (2 s) rule from `stat-cache.ts`
 * and verify the exact inputs consumed by the underlying readers so stale
 * results are never returned.
 */

const MAX_BLOB_ENTRIES = 50_000;
const BLOB_CONCURRENCY = 16;

interface CachedBlob {
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
  readonly ino: number;
  readonly mode: number;
  readonly blob: string;
  readonly hashedAt: number;
}

export interface BlobCache {
  blobs(paths: readonly string[]): Promise<Record<string, string | null>>;
  evict(paths: readonly string[]): void;
  clear(): void;
}

/** Racy-safe stat-cached SHA-1 blob lookup under `root`. */
export function createBlobCache(root: AbsolutePath, now: () => number = Date.now): BlobCache {
  const entries = new Map<string, CachedBlob>();

  const blobOf = async (path: string): Promise<string | null> => {
    if (!insideRoot(path)) return null;
    const at = join(root, path);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(at);
    } catch {
      entries.delete(path);
      return null;
    }
    if (info.isSymbolicLink()) {
      entries.delete(path);
      try {
        return treeBlob(Buffer.from(await readlink(at), "utf8"));
      } catch {
        return null;
      }
    }
    if (!info.isFile()) {
      entries.delete(path);
      return null;
    }
    const cached = entries.get(path);
    if (
      cached !== undefined &&
      cached.mtimeMs === info.mtimeMs &&
      cached.ctimeMs === info.ctimeMs &&
      cached.size === info.size &&
      cached.ino === info.ino &&
      cached.mode === info.mode &&
      cached.hashedAt - info.mtimeMs >= RACY_WINDOW_MS
    ) {
      return cached.blob;
    }
    try {
      const hashedAt = now();
      const bytes = await readFile(at);
      const blob = treeBlob(bytes);
      if (entries.size >= MAX_BLOB_ENTRIES && !entries.has(path)) entries.clear();
      entries.set(path, {
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
        size: info.size,
        ino: info.ino,
        mode: info.mode,
        blob,
        hashedAt,
      });
      return blob;
    } catch {
      entries.delete(path);
      return null;
    }
  };

  return {
    async blobs(paths) {
      const unique = [...new Set(paths)];
      const result: Record<string, string | null> = {};
      let next = 0;
      const worker = async () => {
        while (next < unique.length) {
          const path = unique[next++];
          if (path !== undefined) result[path] = await blobOf(path);
        }
      };
      const count = Math.min(BLOB_CONCURRENCY, unique.length);
      await Promise.all(Array.from({ length: count }, worker));
      return result;
    },
    evict(paths) {
      for (const path of paths) entries.delete(path);
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Installed lockfiles in the exact precedence order of
 * `src/core/keys/environment.ts`.
 */
const INSTALLED_FORMATS = [
  { path: HIDDEN_LOCKFILE, patches: "patches", kind: "npm" },
  { path: "node_modules/.yarn-state.yml", patches: null, kind: "whole" },
  { path: ".pnp.cjs", patches: ".yarn/patches", kind: "whole" },
  { path: ".pnp.js", patches: ".yarn/patches", kind: "whole" },
  { path: "node_modules/.yarn-integrity", patches: "patches", kind: "whole" },
  { path: PNPM_LOCKFILE, patches: null, kind: "pnpm" },
  { path: ".rush/temp/shrinkwrap-deps.json", patches: null, kind: "whole" },
  { path: "bun.lock", patches: "patches", kind: "whole" },
  { path: "bun.lockb", patches: "patches", kind: "whole" },
] as const;

const PNPM_MODULES = "node_modules/.modules.yaml";

type FileProbe =
  | { readonly state: "missing" }
  | { readonly state: "uncacheable" }
  | { readonly state: "file"; readonly sig: string; readonly racy: boolean };

type LayoutProbe =
  | { readonly cacheable: false }
  | {
      readonly cacheable: true;
      readonly kind: "none" | "whole" | "npm" | "pnpm";
      readonly sig: string;
      readonly racy: boolean;
    };

type CachedInstalled =
  | {
      readonly kind: "none" | "whole" | "pnpm-whole";
      readonly sig: string;
      readonly fingerprint: string;
    }
  | {
      readonly kind: "npm";
      readonly sig: string;
      readonly parsed: Record<string, unknown>;
      readonly fingerprint: string;
    }
  | {
      readonly kind: "pnpm";
      readonly sig: string;
      readonly graph: PnpmGraph;
      readonly fingerprint: string;
    };

export interface InstalledFingerprintCache {
  fingerprint(): Promise<string>;
  onInvalidate(paths: readonly string[]): void;
  clear(): void;
}

/** Ensures every intermediate directory segment of `relPath` is missing or a real directory (not a symlink). */
async function parentsSafe(
  root: AbsolutePath,
  relPath: string,
): Promise<"ok" | "missing" | "link"> {
  const parts = relPath.split("/");
  for (let i = 1; i < parts.length; i++) {
    const prefix = join(root, ...parts.slice(0, i));
    try {
      const info = await lstat(prefix);
      if (info.isSymbolicLink()) return "link";
      if (!info.isDirectory()) return "missing";
    } catch (error) {
      if (isMissing(error)) return "missing";
      return "link";
    }
  }
  return "ok";
}

async function probeFile(root: AbsolutePath, relPath: string, at: number): Promise<FileProbe> {
  const parents = await parentsSafe(root, relPath);
  if (parents === "link") return { state: "uncacheable" };
  if (parents === "missing") return { state: "missing" };
  try {
    const info = await lstat(join(root, relPath));
    if (info.isSymbolicLink()) return { state: "uncacheable" };
    if (!info.isFile()) return { state: "missing" };
    return {
      state: "file",
      sig: `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`,
      racy: at - info.mtimeMs < RACY_WINDOW_MS,
    };
  } catch (error) {
    if (isMissing(error)) return { state: "missing" };
    return { state: "uncacheable" };
  }
}

/** Complete recursive `lstat` signature of a patches directory, refusing symlinks. */
async function probePatches(
  root: AbsolutePath,
  patchesRel: string | null,
  at: number,
): Promise<{ cacheable: false } | { cacheable: true; sig: string; racy: boolean }> {
  if (patchesRel === null) return { cacheable: true, sig: "", racy: false };
  const parents = await parentsSafe(root, patchesRel);
  if (parents === "link") return { cacheable: false };
  if (parents === "missing") return { cacheable: true, sig: "missing", racy: false };
  const dir = join(root, patchesRel);
  try {
    const dirInfo = await lstat(dir);
    if (dirInfo.isSymbolicLink()) return { cacheable: false };
    if (!dirInfo.isDirectory()) return { cacheable: true, sig: "missing", racy: false };
  } catch (error) {
    if (isMissing(error)) return { cacheable: true, sig: "missing", racy: false };
    return { cacheable: false };
  }
  let rawEntries: string[];
  try {
    rawEntries = await readdir(dir, { recursive: true });
  } catch (error) {
    if (isMissing(error)) return { cacheable: true, sig: "missing", racy: false };
    return { cacheable: false };
  }
  const entries = rawEntries.map((entry) => entry.split(sep).join("/")).sort(compare);
  const parts: string[] = [];
  let racy = false;
  for (const entry of entries) {
    try {
      const info = await lstat(join(dir, entry));
      if (info.isSymbolicLink()) return { cacheable: false };
      if (info.isDirectory()) {
        parts.push(`d:${entry}`);
      } else if (info.isFile()) {
        if (at - info.mtimeMs < RACY_WINDOW_MS) racy = true;
        parts.push(
          `f:${entry}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`,
        );
      } else {
        return { cacheable: false };
      }
    } catch {
      return { cacheable: false };
    }
  }
  return { cacheable: true, sig: parts.join("\n"), racy };
}

/**
 * Probes the exact lockfile and patches inputs `installedDependencies(root, root)`
 * consumes in precedence order. Returns `{ cacheable: false }` when any
 * relevant path is a symlink or unreadable so the caller bypasses the cache.
 */
async function probeLayout(root: AbsolutePath, at: number): Promise<LayoutProbe> {
  for (const format of INSTALLED_FORMATS) {
    const file = await probeFile(root, format.path, at);
    if (file.state === "uncacheable") return { cacheable: false };
    if (file.state === "missing") continue;

    const patches = await probePatches(root, format.patches, at);
    if (!patches.cacheable) return { cacheable: false };

    let extra = "";
    let racy = file.racy || patches.racy;
    if (format.kind === "pnpm") {
      const modules = await probeFile(root, PNPM_MODULES, at);
      if (modules.state === "uncacheable") return { cacheable: false };
      if (modules.state === "file") {
        extra = modules.sig;
        racy ||= modules.racy;
      } else {
        extra = "missing";
      }
    }
    return {
      cacheable: true,
      kind: format.kind,
      sig: `${format.path}\0${file.sig}\0${extra}\0${patches.sig}`,
      racy,
    };
  }
  return { cacheable: true, kind: "none", sig: "none", racy: false };
}

/** Whether invalidating `path` may have changed local installed dependencies. */
export function touchesInstalled(path: string): boolean {
  if (isInstalledLockfile(path)) return true;
  if (path === "node_modules" || path.startsWith("node_modules/")) return true;
  if (path === "patches" || path.startsWith("patches/")) return true;
  if (path === ".yarn/patches" || path.startsWith(".yarn/patches/")) return true;
  if (path === ".rush" || path.startsWith(".rush/")) return true;
  return (LOCKFILES as readonly string[]).includes(basename(path));
}

/**
 * Exact dependency-validated cache for local `installedDependenciesFingerprint(root, root)`.
 *
 * Whole-file lockfiles and `"none"` are validated by exact precedence, file,
 * and recursive patches `lstat` signatures with `RACY_WINDOW_MS`. Clean npm
 * and pnpm installs additionally re-run `staleHiddenLockfile` /
 * `stalePnpmLockfile` against the cached parsed graph on every lookup, skipping
 * lockfile parsing and hashing while still catching any added, removed, or
 * modified package folder or symlink. Stale installs, symlinks, and racy files
 * bypass the cache completely.
 */
export function createInstalledFingerprintCache(
  root: AbsolutePath,
  now: () => number = Date.now,
): InstalledFingerprintCache {
  let cached: CachedInstalled | null = null;

  const validHit = (probe: Extract<LayoutProbe, { cacheable: true }>): string | null => {
    const entry = cached;
    if (entry === null || probe.racy || entry.sig !== probe.sig) return null;
    if (entry.kind === "npm") {
      try {
        return staleHiddenLockfile(root, entry.parsed) === null ? entry.fingerprint : null;
      } catch {
        return null;
      }
    }
    if (entry.kind === "pnpm") {
      try {
        return stalePnpmLockfile(root, entry.graph) === null ? entry.fingerprint : null;
      } catch {
        return null;
      }
    }
    return entry.fingerprint;
  };

  return {
    async fingerprint() {
      const before = await probeLayout(root, now());
      if (before.cacheable) {
        const hit = validHit(before);
        if (hit !== null) return hit;
      }

      const installed = await installedDependencies(root, root);
      if (!before.cacheable || before.racy || installed.note !== null) {
        cached = null;
        return installed.fingerprint;
      }

      let candidate: CachedInstalled | null = null;
      if (before.kind === "none" || before.kind === "whole") {
        candidate = {
          kind: before.kind,
          sig: before.sig,
          fingerprint: installed.fingerprint,
        };
      } else if (before.kind === "pnpm") {
        candidate =
          installed.graph instanceof PnpmGraph
            ? {
                kind: "pnpm",
                sig: before.sig,
                graph: installed.graph,
                fingerprint: installed.fingerprint,
              }
            : {
                kind: "pnpm-whole",
                sig: before.sig,
                fingerprint: installed.fingerprint,
              };
      } else if (before.kind === "npm") {
        try {
          const parsed = parseHiddenLockfile(await readFile(join(root, HIDDEN_LOCKFILE)));
          if (parsed !== null && staleHiddenLockfile(root, parsed) === null) {
            candidate = {
              kind: "npm",
              sig: before.sig,
              parsed,
              fingerprint: installed.fingerprint,
            };
          }
        } catch {
          candidate = null;
        }
      }

      if (candidate !== null) {
        const after = await probeLayout(root, now());
        cached = after.cacheable && !after.racy && after.sig === before.sig ? candidate : null;
      } else {
        cached = null;
      }
      return installed.fingerprint;
    },
    onInvalidate(paths) {
      if (cached !== null && paths.some(touchesInstalled)) cached = null;
    },
    clear() {
      cached = null;
    },
  };
}
