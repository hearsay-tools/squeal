import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
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

/** Content key of a full bundle: HEAD commit and tags, independent of branch name. */
export function fullBundleKey(local: GitState): string {
  const lines = local.refs.split("\n").filter((line) => !line.startsWith("ref "));
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 24);
}

/** Expected `HEAD` and `refs/tags/*` map carried by `local`. */
function expectedBundleRefs(local: GitState): {
  readonly head: string;
  readonly tags: ReadonlyMap<string, string>;
} {
  const tags = new Map<string, string>();
  for (const line of local.refs.split("\n")) {
    if (!line.startsWith("tag ")) continue;
    const rest = line.slice(4);
    const space = rest.indexOf(" ");
    if (space > 0) tags.set(rest.slice(space + 1), rest.slice(0, space));
  }
  return { head: local.head, tags };
}

/** Computes the live repository's `fullBundleKey` from `git show-ref --head --tags`. */
async function currentFullBundleKey(root: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "show-ref", "--head", "--tags"], {
      maxBuffer: 64 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    });
    const shown = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .map((line) => line.split(" "));
    const head = shown.find(([, name]) => name === "HEAD")?.[0];
    if (head === undefined || !/^[0-9a-f]{40,64}$/.test(head)) return null;
    const tags = shown
      .filter(([object, name]) => object !== undefined && name?.startsWith("refs/tags/") === true)
      .map(([object, name]) => `tag ${object} ${name}`)
      .sort();
    const text = [`head ${head}`, ...tags].join("\n");
    return createHash("sha256").update(text).digest("hex").slice(0, 24);
  } catch {
    return null;
  }
}

/**
 * Verifies that `bundlePath`'s advertised `HEAD` and `refs/tags/*` match
 * `local` exactly. Reads only the bundle header (`git bundle list-heads`).
 */
async function bundleMatchesState(
  bundlePath: string,
  local: GitState,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["bundle", "list-heads", bundlePath], {
      maxBuffer: 64 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    });
    const expected = expectedBundleRefs(local);
    let head: string | undefined;
    const tags = new Map<string, string>();
    for (const raw of stdout.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      const space = line.indexOf(" ");
      if (space <= 0) continue;
      const oid = line.slice(0, space);
      const name = line.slice(space + 1);
      if (name === "HEAD") head = oid;
      else if (name.startsWith("refs/tags/")) tags.set(name, oid);
    }
    if (head !== expected.head || tags.size !== expected.tags.size) return false;
    for (const [name, oid] of expected.tags) {
      if (tags.get(name) !== oid) return false;
    }
    return true;
  } catch {
    return false;
  }
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
 * Pins `cached` into caller-owned `target` while holding the cache lock:
 * hard-links first, and copies on cross-device or unsupported link errors so
 * later pruning can never delete the caller's bundle.
 */
async function pinToCaller(cached: string, target: string): Promise<void> {
  try {
    await link(cached, target);
    return;
  } catch {
    await rm(target, { force: true }).catch(() => {});
  }
  try {
    await copyFile(cached, target);
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

/** Builds, validates, atomically publishes, and prunes `cached` when it does not already match `local`. */
async function ensureCachedBundle(
  root: string,
  local: GitState,
  cacheDir: string,
  cached: string,
  key: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if ((await hasBundle(cached)) && (await bundleMatchesState(cached, local, signal))) return true;
  signal?.throwIfAborted();
  if ((await currentFullBundleKey(root, signal)) !== key) return false;
  const tmp = join(cacheDir, `${key}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await createGitBundle(root, tmp, ["HEAD", "--tags"], signal);
    signal?.throwIfAborted();
    if (!(await bundleMatchesState(tmp, local, signal))) {
      await rm(tmp, { force: true }).catch(() => {});
      return false;
    }
    await rename(tmp, cached);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    if (signal?.aborted === true) throw error;
    return false;
  }
  await pruneCache(cacheDir, cached);
  return true;
}

/**
 * Attempts to serve `local`'s full bundle through the shared repository cache,
 * returning a caller-owned path inside `callerDir` or `null` when the optional
 * cache cannot be used or does not match the live repository state.
 */
async function trySharedCache(
  root: string,
  local: GitState,
  target: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const common = await gitCommonDir(root);
  if (common === null) return null;
  const cacheDir = join(common, "squeal", "remote-bundles");
  try {
    await mkdir(cacheDir, { recursive: true });
  } catch {
    return null;
  }
  const lockPath = join(cacheDir, "bundle.lock.sqlite") as AbsolutePath;
  let acquired: Awaited<ReturnType<typeof awaitDaemonLock>>;
  try {
    acquired = await awaitDaemonLock(lockPath, {
      timeoutMs: deadlineMs,
      pollMs: 50,
      checkMs: 50,
      giveUp: () => signal?.aborted === true,
    });
  } catch {
    signal?.throwIfAborted();
    return null;
  }
  if (acquired === "gave-up" || acquired === "timed-out") {
    signal?.throwIfAborted();
    return null;
  }
  try {
    signal?.throwIfAborted();
    const key = fullBundleKey(local);
    const cached = join(cacheDir, `${key}.bundle`);
    if (!(await ensureCachedBundle(root, local, cacheDir, cached, key, signal))) return null;
    signal?.throwIfAborted();
    try {
      await pinToCaller(cached, target);
      return target;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return null;
    }
  } finally {
    acquired.release();
  }
}

/**
 * Returns a caller-owned readable full-bundle file path for `local`, reusing
 * and caching per `(commonDir, fullBundleKey(local))` under a per-repository
 * lock. Hard-links (or copies across devices) the cached bundle into
 * `callerDir` before releasing the lock so later cache pruning never removes
 * the file while this caller streams it.
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
  const fromCache = await trySharedCache(root, local, fallback, deadlineMs, signal);
  if (fromCache !== null) return fromCache;
  signal?.throwIfAborted();
  await createGitBundle(root, fallback, ["HEAD", "--tags"], signal);
  return fallback;
}
