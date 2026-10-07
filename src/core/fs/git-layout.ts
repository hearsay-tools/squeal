/**
 * The read-only git layout of a worktree, read from the filesystem without
 * spawning git. Hooks use it, so it imports nothing but `node:` modules.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AbsolutePath, WorktreeId } from "../types/index.js";
import { isMissing } from "./errors.js";

/** The `gitdir:` line of a `.git` file. */
const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;

/**
 * The worktree that contains `path`: the nearest ancestor (or `path` itself)
 * with a `.git` entry. Spec 001 D1: "A **worktree** is one git working tree:
 * the nearest ancestor of a path that is a git top level." Returns `null`
 * outside any worktree.
 */
export function findWorktreeRoot(path: AbsolutePath): AbsolutePath | null {
  let dir = resolve(path);
  if (existsSync(dir)) dir = realpathSync(dir);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** True when `<dir>/.git` exists. A file (linked worktree, submodule) counts as much as a directory. */
export async function hasGitEntry(dir: AbsolutePath): Promise<boolean> {
  try {
    await lstat(join(dir, ".git"));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * Stable id of a worktree: the first 16 hex characters of sha256 over its
 * realpath. Used in lock and socket names (spec 001 D1), so it must not depend
 * on how the path was spelled. Throws when `root` does not exist.
 */
export function worktreeIdFor(root: AbsolutePath): WorktreeId {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}

/**
 * The git dir of the worktree at `root`: `<root>/.git` when it is a
 * directory, else the `gitdir:` its `.git` file points to, resolved against
 * `root`. `null` without a `.git` directory or a `.git` file with a `gitdir:`
 * line. The target is not checked to exist.
 */
export function gitDirOf(root: AbsolutePath): AbsolutePath | null {
  return dotGit(root)?.gitDir ?? null;
}

/**
 * The `<common-dir>/worktrees/<name>` entry of a linked worktree: the
 * `gitdir:` of its `.git` file. `null` for a main worktree, whose `.git` is a
 * directory. Spec 001 D10: the daemon exits "when
 * `<common-dir>/worktrees/<name>` disappears".
 */
export function linkedWorktreeDir(root: AbsolutePath): AbsolutePath | null {
  const entry = dotGit(root);
  return entry?.isFile ? entry.gitDir : null;
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
  const entry = dotGit(root);
  if (entry === null) return null;
  if (!entry.isFile) return realpathSync(entry.gitDir);
  const { gitDir } = entry;
  if (lstatOrNull(gitDir) === null) return null;

  const commondirFile = join(gitDir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync(gitDir);
  const commondir = readFileSync(commondirFile, "utf8").trim();
  const common = isAbsolute(commondir) ? commondir : resolve(gitDir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync(common);
}

/** `lstat` of `path`, or `null` when it does not exist. */
export function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** `<root>/.git` read once: the git dir it names and whether it was a `.git` file. */
interface DotGit {
  readonly gitDir: AbsolutePath;
  readonly isFile: boolean;
}

function dotGit(root: AbsolutePath): DotGit | null {
  const path = join(root, ".git");
  const stat = lstatOrNull(path);
  if (stat === null) return null;
  if (stat.isDirectory()) return { gitDir: path, isFile: false };
  if (!stat.isFile()) return null;
  const match = GITDIR_LINE.exec(readFileSync(path, "utf8"));
  return match?.[1] ? { gitDir: resolve(root, match[1]), isFile: true } : null;
}
