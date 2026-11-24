import { lstat, readFile, readlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { RACY_WINDOW_MS } from "../../hash/stat-cache.js";
import { installedDependenciesFingerprint, isInstalledLockfile } from "../../keys/environment.js";
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
 * so same-tick rewrites are always re-hashed.
 */

const MAX_BLOB_ENTRIES = 50_000;
const BLOB_CONCURRENCY = 16;
const INSTALLED_TTL_MS = 30_000;

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

/** Paths whose stat changes when a local package-manager install or patch changes. */
const INSTALLED_WATCH_PATHS = [
  "node_modules",
  "node_modules/.pnpm",
  "node_modules/.pnpm/lock.yaml",
  "node_modules/.modules.yaml",
  "node_modules/.package-lock.json",
  "node_modules/.yarn-state.yml",
  "node_modules/.yarn-integrity",
  ".pnp.cjs",
  ".pnp.js",
  "bun.lock",
  "bun.lockb",
  "patches",
] as const;

interface InstalledSnapshot {
  readonly signature: string;
  readonly fingerprint: string;
  readonly at: number;
  readonly racy: boolean;
}

export interface InstalledFingerprintCache {
  fingerprint(): Promise<string>;
  onInvalidate(paths: readonly string[]): void;
  clear(): void;
}

async function statSignature(
  root: AbsolutePath,
  at: number,
): Promise<{ signature: string; racy: boolean }> {
  const stats = await Promise.all(
    INSTALLED_WATCH_PATHS.map((rel) => lstat(join(root, rel)).catch(() => null)),
  );
  let racy = false;
  const parts = stats.map((info) => {
    if (info === null) return "-";
    if (at - info.mtimeMs < RACY_WINDOW_MS) racy = true;
    return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  });
  return { signature: parts.join("|"), racy };
}

/** Whether invalidating `path` may have changed local installed dependencies. */
export function touchesInstalled(path: string): boolean {
  if (isInstalledLockfile(path)) return true;
  if (path === "node_modules" || path.startsWith("node_modules/")) return true;
  if (path === "patches" || path.startsWith("patches/")) return true;
  return (LOCKFILES as readonly string[]).includes(basename(path));
}

/** Stat-guarded, TTL-bounded cache for local `installedDependenciesFingerprint(root, root)`. */
export function createInstalledFingerprintCache(
  root: AbsolutePath,
  now: () => number = Date.now,
): InstalledFingerprintCache {
  let cached: InstalledSnapshot | null = null;

  return {
    async fingerprint() {
      const at = now();
      const { signature, racy } = await statSignature(root, at);
      if (
        cached !== null &&
        !cached.racy &&
        !racy &&
        cached.signature === signature &&
        at - cached.at < INSTALLED_TTL_MS
      ) {
        return cached.fingerprint;
      }
      const fingerprint = await installedDependenciesFingerprint(root, root);
      const after = await statSignature(root, now());
      cached =
        after.signature === signature
          ? { signature, fingerprint, at, racy: racy || after.racy }
          : null;
      return fingerprint;
    },
    onInvalidate(paths) {
      if (cached !== null && paths.some(touchesInstalled)) cached = null;
    },
    clear() {
      cached = null;
    },
  };
}
