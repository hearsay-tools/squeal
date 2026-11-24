import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { awaitDaemonLock } from "../../../../daemon/lock.js";
import type { AbsolutePath } from "../../../../types/common.js";
import type { GitState } from "./bootstrap.js";

/*
 * Deduplicated, single-threaded full Git bundle cache for Agent37 bootstrap.
 *
 * When several worktree daemons of one repository start fresh VMs at the same
 * commit, each previously ran `git bundle create` concurrently with Git's
 * default `pack.threads` (every CPU on the host), repacking the entire history
 * in parallel. Full bundles depend only on HEAD's commit and the tag map (never
 * on the local branch name, which `SYNC_SCRIPT` receives separately in `refs`),
 * so worktrees on different branches at the same commit share one cached bundle
 * built with `-c pack.threads=1` under a per-repository exclusive lock.
 */

const run = promisify(execFile);

/** Maximum cached full bundles kept per repository so disk stays bounded. */
const MAX_CACHED_BUNDLES = 2;

/** Git config args that bound pack-objects CPU to a single thread. */
export const SINGLE_THREAD_PACK = ["-c", "pack.threads=1"] as const;

const NO_HARD_LINKS: ReadonlySet<string> = new Set(["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP"]);

/** Content key of a full bundle: HEAD commit and tags, independent of branch name. */
export function fullBundleKey(local: GitState): string {
  const lines = local.refs.split("\n").filter((line) => !line.startsWith("ref "));
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 24);
}

/** Shared `.git` common directory of `root`, or `null` when unavailable. */
async function gitCommonDir(root: string): Promise<AbsolutePath | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "rev-parse", "--git-common-dir"], {
      maxBuffer: 1024 * 1024,
    });
    const raw = stdout.trim();
    return raw === "" ? null : (resolve(root, raw) as AbsolutePath);
  } catch {
    return null;
  }
}

/** Runs `git -C root -c pack.threads=1 bundle create -q target ...args`. */
export async function createGitBundle(
  root: string,
  target: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<void> {
  await run("git", ["-C", root, ...SINGLE_THREAD_PACK, "bundle", "create", "-q", target, ...args], {
    maxBuffer: 1024 * 1024,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** Whether `path` exists as a non-empty regular file. */
async function hasBundle(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Keeps `keep` and at most `MAX_CACHED_BUNDLES - 1` other newest `*.bundle` files in `cacheDir`. */
async function pruneCache(cacheDir: string, keep: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return;
  }
  const dated: { path: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".bundle")) continue;
    const path = join(cacheDir, name);
    if (path === keep) continue;
    try {
      const info = await stat(path);
      dated.push({ path, mtimeMs: info.mtimeMs });
    } catch {
      // Removed concurrently.
    }
  }
  dated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of dated.slice(Math.max(0, MAX_CACHED_BUNDLES - 1))) {
    await rm(stale.path, { force: true }).catch(() => {});
  }
}

/**
 * Returns a readable full-bundle file path for `local`, reusing and caching
 * per `(commonDir, fullBundleKey(local))` under a per-repository lock.
 * Hard-links the cached bundle into `callerDir` before releasing the lock so
 * later cache pruning never removes the file while this caller streams it.
 */
export async function sharedFullBundle(
  root: string,
  local: GitState,
  callerDir: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const fallback = join(callerDir, "full.bundle");
  const common = await gitCommonDir(root);
  if (common === null) {
    await createGitBundle(root, fallback, ["HEAD", "--tags"], signal);
    return fallback;
  }
  const cacheDir = join(common, "squeal", "remote-bundles");
  try {
    await mkdir(cacheDir, { recursive: true });
  } catch {
    await createGitBundle(root, fallback, ["HEAD", "--tags"], signal);
    return fallback;
  }
  const lockPath = join(cacheDir, "bundle.lock.sqlite") as AbsolutePath;
  const acquired = await awaitDaemonLock(lockPath, {
    timeoutMs: deadlineMs,
    pollMs: 50,
    checkMs: 50,
    giveUp: () => signal?.aborted === true,
  });
  signal?.throwIfAborted();
  if (acquired === "gave-up" || acquired === "timed-out") {
    await createGitBundle(root, fallback, ["HEAD", "--tags"], signal);
    return fallback;
  }
  try {
    const key = fullBundleKey(local);
    const cached = join(cacheDir, `${key}.bundle`);
    if (!(await hasBundle(cached))) {
      const tmp = join(cacheDir, `${key}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      try {
        await createGitBundle(root, tmp, ["HEAD", "--tags"], signal);
        await rename(tmp, cached);
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
      await pruneCache(cacheDir, cached);
    }
    try {
      await link(cached, fallback);
      return fallback;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (NO_HARD_LINKS.has(code)) return cached;
      throw error;
    }
  } finally {
    acquired.release();
  }
}
