import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isMissing } from "../fs/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/**
 * Stable id of a worktree: the first 16 hex characters of sha256 over its
 * realpath. Used in lock and socket names (spec 001 D1), so it must not depend
 * on how the path was spelled. Throws when `root` does not exist.
 */
export function worktreeIdFor(root: AbsolutePath): WorktreeId {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}

/**
 * The git common directory of the worktree at `root`, without spawning git.
 *
 * Spec 001 D1: "if `<root>/.git` is a directory, that is it; if it is a file,
 * follow its `gitdir:` entry and then `<gitdir>/commondir`." A gitdir without
 * `commondir` (a submodule) is its own common dir. Returns `null` when `root`
 * has no usable `.git` entry. Hooks use this; the daemon asks git.
 */
export function resolveCommonDir(root: AbsolutePath): AbsolutePath | null {
  const dotGit = join(root, ".git");
  const stat = lstatOrNull(dotGit);
  if (stat === null) return null;
  if (stat.isDirectory()) return realpathSync(dotGit);
  if (!stat.isFile()) return null;

  const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
  if (!match?.[1]) return null;
  const gitdir = resolve(root, match[1]);
  if (lstatOrNull(gitdir) === null) return null;

  const commondirFile = join(gitdir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync(gitdir);
  const commondir = readFileSync(commondirFile, "utf8").trim();
  const common = isAbsolute(commondir) ? commondir : resolve(gitdir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync(common);
}

/** Spec 001 D1: the store layout under `<git-common-dir>/squeal/`. */
export interface StorePaths {
  readonly dir: AbsolutePath;
  readonly database: AbsolutePath;
  readonly runsDir: AbsolutePath;
  readonly locksDir: AbsolutePath;
}

export function storePaths(commonDir: AbsolutePath): StorePaths {
  const dir = join(commonDir, "squeal");
  return {
    dir,
    database: join(dir, "store.sqlite"),
    runsDir: join(dir, "runs"),
    locksDir: join(dir, "locks"),
  };
}

/** Spec 001 D1: "`locks/<worktree-hash>.sqlite`: one exclusive-lock database per worktree". */
export function lockFileFor(commonDir: AbsolutePath, worktreeId: WorktreeId): AbsolutePath {
  return join(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
