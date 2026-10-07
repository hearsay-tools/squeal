import { hasGitEntry, toAbsolute } from "../fs/index.js";
import type { AbsolutePath, RelativePath, WatchSpec } from "../types/index.js";
import { checkIgnored, type GitStatus, gitStatus, listIgnored, listSubmodules } from "./git.js";

/**
 * Builds the watch-time exclusions from git.
 *
 * Spec 001 D2: "at watch time, exclude `.git`, nested worktree roots, and the
 * output of `git ls-files --others --ignored --exclude-standard
 * --directory`". Spec 001 D1: a directory below the root "that contains its
 * own `.git` entry is another worktree, or a clone or submodule, and is opaque
 * to the parent".
 *
 * `ls-files --directory` also lists a directory whose current contents are all
 * ignored although the directory itself is not (`logs/` holding only `*.log`).
 * Excluding it would hide the next non-ignored file created there, so
 * directory entries are kept only when `check-ignore` ignores the directory.
 *
 * `status` lets a caller that already ran `git status` reuse it.
 */
export async function buildWatchSpec(
  root: AbsolutePath,
  extraFiles: readonly RelativePath[] = [],
  status?: GitStatus,
): Promise<WatchSpec> {
  const [ignoredEntries, gitState, submodules] = await Promise.all([
    listIgnored(root),
    status ?? gitStatus(root),
    listSubmodules(root),
  ]);

  const dirs = ignoredEntries.filter((e) => e.endsWith("/")).map((e) => e.slice(0, -1));
  const ignoredDirs = await checkIgnored(root, dirs);
  const excluded = new Set<RelativePath>([".git"]);
  for (const entry of ignoredEntries) {
    if (!entry.endsWith("/")) excluded.add(entry);
  }
  for (const dir of dirs) {
    if (ignoredDirs.has(dir)) excluded.add(dir);
  }
  for (const dir of gitState.nestedRepos) excluded.add(dir);
  for (const dir of submodules) {
    if (await hasGitEntry(toAbsolute(root, dir))) excluded.add(dir);
  }

  return {
    root,
    excluded: [...excluded].sort().map((p) => toAbsolute(root, p)),
    extraFiles: [...new Set(extraFiles)].sort().map((p) => toAbsolute(root, p)),
  };
}

export function sameWatchSpec(a: WatchSpec, b: WatchSpec): boolean {
  return (
    a.root === b.root && sameList(a.excluded, b.excluded) && sameList(a.extraFiles, b.extraFiles)
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
