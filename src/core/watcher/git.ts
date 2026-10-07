import { runGit, splitNul } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { ignoredAsDirectories, SymlinkProbe } from "./links.js";

/**
 * Paths among `paths` that git ignores. One `git check-ignore --stdin` call.
 * Tracked files are never reported, even when a pattern matches them.
 *
 * Git refuses a path beyond a symlinked directory and can never track one, so
 * such a path takes the class of the outermost link above it, which git does
 * accept: when git ignores the link, or a directory at the link's path (a
 * linked `node_modules` under `node_modules/`), the path is ignored; otherwise
 * the link is a project directory and the path is not ignored. A batch git
 * rejects anyway is split until the path it names stands alone, and that path
 * counts as ignored.
 *
 * Spec 001 D2: "at batch time, run the paths through one `git check-ignore
 * --stdin`".
 */
export async function checkIgnored(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  const probe = new SymlinkProbe(root);
  const beyond = new Map<RelativePath, RelativePath>();
  const asked = new Set<RelativePath>();
  for (const path of paths) {
    const link = await probe.linkAbove(path);
    if (link === null) asked.add(path);
    else beyond.set(path, link);
  }
  const links = new Set(beyond.values());
  const answered = new Set(await checkIgnoredBatch(root, [...new Set([...asked, ...links])]));
  const ignoredLinks = await ignoredAsDirectories(
    root,
    [...links].filter((link) => !answered.has(link)),
  );
  for (const link of links) {
    if (answered.has(link)) ignoredLinks.add(link);
  }
  const ignored = new Set<RelativePath>();
  for (const path of paths) {
    const link = beyond.get(path);
    if (link === undefined ? answered.has(path) : ignoredLinks.has(link)) ignored.add(path);
  }
  return ignored;
}

/**
 * The symlinked directories among `links` whose subtree is ignored, by the
 * rule `checkIgnored` applies to the paths beyond them.
 */
export async function ignoredLinks(
  root: AbsolutePath,
  links: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  const answered = new Set(await checkIgnoredBatch(root, links));
  const ignored = await ignoredAsDirectories(
    root,
    links.filter((link) => !answered.has(link)),
  );
  for (const link of answered) ignored.add(link);
  return ignored;
}

async function checkIgnoredBatch(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  const input = `${paths.join("\0")}\0`;
  try {
    // Exit 1 means no path is ignored.
    return splitNul(
      await runGit(root, ["check-ignore", "-z", "--stdin"], { input, okCodes: [0, 1] }),
    );
  } catch (error) {
    const [only] = paths;
    // A lone path git names in its refusal is unclassifiable; any other failure is git's own.
    if (paths.length === 1 && only !== undefined) {
      if ((error as Error).message.includes(`'${only}'`)) return [only];
      throw error;
    }
    const half = Math.ceil(paths.length / 2);
    return [
      ...(await checkIgnoredBatch(root, paths.slice(0, half))),
      ...(await checkIgnoredBatch(root, paths.slice(half))),
    ];
  }
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
