import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { compare } from "../fs/compare.js";
import { isMissing } from "../fs/errors.js";
import { isRecord } from "../fs/json.js";
import type { AbsolutePath } from "../types/common.js";
import { commitIdentity } from "./commit-identity.js";
import { ownerState } from "./marker.js";
import { cacheRepositoryDirs, type ListedCheckout, listCheckouts } from "./sweep.js";

/*
 * Spec 023 D7.1, D7.4 (row 023-38): what names a commit worktree, and how
 * many may live at once. A commit fixes every file git holds, so the
 * environment fingerprint covers what D2's environment reads beside them:
 * the Node version, the platform, the architecture and the allow-listed
 * variables the caller passes. The ceiling follows the machine's free
 * memory, 1 GB per commit daemon (the coordinator, 2026-11-21: the research
 * measured 0.7 to 1.8 GB idle), at least 1, unless the caller passes the
 * configured number.
 *
 * Review wave-22 B3: the count is machine-wide. A worktree in a
 * repository's git folder (D4.2's fallback) lies where no other repository
 * looks, so each one is registered under the shared cache root: one file
 * per worktree, naming its folder. A count reads the registrations, drops
 * those whose folder is gone or is no commit worktree Squeal made, and
 * counts those whose owner lives, beside the worktrees under the cache root.
 */

/** The memory one commit daemon is counted at. */
export const COMMIT_DAEMON_BYTES = 1024 ** 3;

/** The fingerprint of this process's environment and of `variables` (the allow-listed ones). */
export function environmentFingerprint(variables: Readonly<Record<string, string>> = {}): string {
  const env = Object.keys(variables)
    .sort(compare)
    .map((name) => [name, variables[name]]);
  const inputs = { node: process.version, platform: process.platform, arch: process.arch, env };
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
}

export interface CeilingInputs {
  /** The configured ceiling; it wins when it is a whole number of at least 1. */
  readonly configured?: number | undefined;
  /** `os.freemem()` by default. */
  readonly freeBytes?: number | undefined;
  readonly perDaemonBytes?: number | undefined;
}

/** D7.4: how many commit worktrees may live at once: free memory over 1 GB, at least 1. */
export function commitWorktreeCeiling(inputs: CeilingInputs = {}): number {
  const { configured } = inputs;
  if (configured !== undefined && Number.isInteger(configured) && configured >= 1)
    return configured;
  const free = inputs.freeBytes ?? freemem();
  return Math.max(1, Math.floor(free / (inputs.perDaemonBytes ?? COMMIT_DAEMON_BYTES)));
}

/**
 * The live commit worktrees of every repository: those under `cacheRoot`,
 * in `dirs`, and those registered under `cacheRoot`. A worktree counts once.
 */
export function liveCommitWorktrees(
  cacheRoot: AbsolutePath,
  dirs: readonly AbsolutePath[] = [],
): ListedCheckout[] {
  const listed = listCheckouts([...new Set([...cacheRepositoryDirs(cacheRoot), ...dirs])]).filter(
    (one) => one.marker?.fingerprint !== undefined,
  );
  const byFolder = new Map(listed.map((one) => [realOrSelf(one.folder), one]));
  for (const one of registered(cacheRoot)) byFolder.set(one.folder, one);
  return [...byFolder.values()]
    .filter((one) => one.owner !== "dead")
    .sort((a, b) => compare(a.folder, b.folder));
}

/** The registrations' dir under the cache root. */
export function placesDir(cacheRoot: AbsolutePath): AbsolutePath {
  return join(cacheRoot, "commit-places");
}

/** Registers the commit worktree folder `folder` under `cacheRoot`, so every count sees it. */
export function registerPlace(cacheRoot: AbsolutePath, folder: AbsolutePath): void {
  const dir = placesDir(cacheRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${createHash("sha256").update(folder).digest("hex").slice(0, 16)}.json`);
  const temp = `${path}.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, folder })}\n`);
  renameSync(temp, path);
}

/** The registered worktrees that are whole; a registration of anything else is removed. */
function registered(cacheRoot: AbsolutePath): ListedCheckout[] {
  const dir = placesDir(cacheRoot);
  const listed: ListedCheckout[] = [];
  for (const name of registrations(dir)) {
    const path = join(dir, name);
    const folder = folderOf(path);
    const identity = folder === null ? null : commitIdentity(join(folder, "tree"));
    if (identity === null) {
      rmSync(path, { force: true });
      continue;
    }
    const { marker } = identity;
    listed.push({
      folder: identity.folder,
      tree: identity.tree,
      marker,
      owner: ownerState(marker),
    });
  }
  return listed;
}

function registrations(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function folderOf(path: AbsolutePath): AbsolutePath | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) && typeof value.folder === "string" ? value.folder : null;
  } catch {
    return null;
  }
}

function realOrSelf(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The machine's lock over counting and making commit worktrees, under the cache root. */
export function placesLockPath(cacheRoot: AbsolutePath): AbsolutePath {
  return join(cacheRoot, "commit-places.lock");
}

/** The line a creator says once when the ceiling makes it wait. */
export function waitsLine(live: readonly ListedCheckout[], ceiling: number): string {
  const commits = live.map((listed) => listed.marker?.commit.slice(0, 12) ?? "?").join(", ");
  return `squeal: waiting for a place: ${live.length} of ${ceiling} commit worktrees live (${commits}); one frees when its daemon exits or \`squeal stop --at <commit>\` stops it`;
}
