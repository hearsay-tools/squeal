import { runGit, splitNul } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/**
 * Paths among `paths` that git ignores. One `git check-ignore --stdin` call.
 * Tracked files are never reported, even when a pattern matches them.
 *
 * Spec 001 D2: "at batch time, run the paths through one `git check-ignore
 * --stdin`".
 */
export async function checkIgnored(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  if (paths.length === 0) return new Set();
  const input = `${paths.join("\0")}\0`;
  // Exit 1 means no path is ignored.
  const out = await runGit(root, ["check-ignore", "-z", "--stdin"], { input, okCodes: [0, 1] });
  return new Set(splitNul(out));
}

/**
 * Untracked ignored entries, collapsed to directories with a trailing `/`.
 *
 * Spec 001 D2: "the output of `git ls-files --others --ignored
 * --exclude-standard --directory`".
 */
export async function listIgnored(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
  ]);
  return splitNul(out);
}

export interface GitStatus {
  /** Paths git reports as modified, added, deleted or untracked; sorted. */
  readonly paths: readonly RelativePath[];
  /** Untracked directories git stops at because they hold their own `.git`; sorted. */
  readonly nestedRepos: readonly RelativePath[];
}

/**
 * `git status --porcelain` with every untracked file listed. Runs without
 * optional locks so it never takes `index.lock` from under the agent.
 *
 * Spec 001 D2: "A reconciliation pass [...]: `git status --porcelain` plus a
 * re-stat of every file in the hash cache."
 */
export async function gitStatus(root: AbsolutePath): Promise<GitStatus> {
  const out = await runGit(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
    "--ignore-submodules=all",
  ]);
  const paths = new Set<RelativePath>();
  const nestedRepos = new Set<RelativePath>();
  for (const entry of splitNul(out)) {
    // "XY path": two status letters and a space. --no-renames means no second path.
    const path = entry.slice(3);
    // With --untracked-files=all git lists a directory only when it is another repository.
    if (path.endsWith("/")) nestedRepos.add(path.slice(0, -1));
    else paths.add(path);
  }
  return { paths: [...paths].sort(), nestedRepos: [...nestedRepos].sort() };
}

/** Paths of submodules declared in `.gitmodules`, which git status does not list when clean. */
export async function listSubmodules(root: AbsolutePath): Promise<string[]> {
  const out = await runGit(
    root,
    ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    // 1: no match or no such file.
    { okCodes: [0, 1] },
  );
  // -z prints "key\nvalue\0".
  return splitNul(out).flatMap((entry) => {
    const value = entry.slice(entry.indexOf("\n") + 1);
    return value === "" ? [] : [value];
  });
}
