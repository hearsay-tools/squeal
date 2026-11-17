import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isMissing } from "../fs/errors.js";
import { runGit, splitNul } from "../fs/git.js";
import { blobHash, type ObjectFormat } from "../hash/blob.js";
import { readObjectFormat } from "../hash/git-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { LS_TREE_TIMEOUT_MS, lsTreeArgs } from "./tree.js";

/*
 * Spec 023 D4.7 (row 023-07, review wave-7 re-review B5; the human,
 * 2026-11-17, "Byte check"): a file keyed in the checkout is the commit's
 * only when every input its key reads is the commit's: the bytes, the file
 * mode and the symlink target of each path its closure loads and of its
 * project's runner files, compared with the commit's own tree (`git
 * ls-tree` of the commit, blob ids by Squeal's `blobHash`). Neither the
 * checkout's index, its flags (`assume-unchanged`, `skip-worktree`) nor its
 * `HEAD` is read, so an install that hides a change from `git status` is
 * still found. A path the commit does not hold is D4.9's, not this check's.
 */

/** One path of the commit's tree: its git mode and its blob id. */
export interface CommitEntry {
  readonly mode: string;
  readonly blob: string;
}

/** Each blob path of `commit`'s tree with its mode; submodules are left out. */
export async function commitEntries(
  root: AbsolutePath,
  commit: string,
): Promise<Map<RelativePath, CommitEntry>> {
  const out = await runGit(root, lsTreeArgs(commit), { timeoutMs: LS_TREE_TIMEOUT_MS });
  const entries = new Map<RelativePath, CommitEntry>();
  for (const entry of splitNul(out)) {
    // `<mode> SP <type> SP <object> TAB <path>`
    const tab = entry.indexOf("\t");
    const [mode, type, blob] = entry.slice(0, tab).split(" ");
    if (tab > 0 && type === "blob" && mode !== undefined && blob !== undefined)
      entries.set(entry.slice(tab + 1), { mode, blob });
  }
  return entries;
}

/** A tracked symlink the checkout no longer has as the commit does, and where it now leads. */
export interface ChangedLink {
  readonly link: RelativePath;
  /** What it resolves to in the tree now, relative to the tree; `null` when nothing, or outside it. */
  readonly resolved: RelativePath | null;
}

export interface InputCheck {
  /**
   * The first of `paths` (in their order) whose file in the tree differs
   * from the commit's in bytes, mode or link target, or is gone; `null`
   * when none does. Each path is read once per check.
   */
  changed(paths: Iterable<RelativePath>): Promise<RelativePath | null>;
  /**
   * Every symlink the commit holds that differs in the tree. A runner
   * resolves a link before it lists a load, so a closure names the link's
   * target, not the link: a caller matches loads against `resolved`.
   */
  readonly links: readonly ChangedLink[];
}

/** Reads the checkout's files in `tree` against `commit`'s entries. */
export async function inputCheck(
  root: AbsolutePath,
  tree: AbsolutePath,
  commit: string,
): Promise<InputCheck> {
  const entries = await commitEntries(root, commit);
  const format = await readObjectFormat(root);
  const seen = new Map<RelativePath, boolean>();
  const same = async (path: RelativePath, entry: CommitEntry) => {
    let known = seen.get(path);
    if (known === undefined) {
      known = await matches(join(tree, path), entry, format);
      seen.set(path, known);
    }
    return known;
  };
  const links: ChangedLink[] = [];
  for (const [link, entry] of entries) {
    if (entry.mode !== "120000" || (await same(link, entry))) continue;
    links.push({ link, resolved: await resolvedIn(tree, link) });
  }
  return {
    links,
    async changed(paths) {
      for (const path of paths) {
        const entry = entries.get(path);
        if (entry !== undefined && !(await same(path, entry))) return path;
      }
      return null;
    },
  };
}

/** Where `link` leads in `tree` now, relative to it; `null` when nowhere, or outside the tree. */
async function resolvedIn(tree: AbsolutePath, link: RelativePath): Promise<RelativePath | null> {
  try {
    const at = relative(await realpath(tree), await realpath(join(tree, link)));
    return at === "" || at.startsWith("..") ? null : at.split(sep).join("/");
  } catch {
    return null;
  }
}

/** Whether the file at `path` is `entry`: its kind and mode, then its blob. */
async function matches(path: string, entry: CommitEntry, format: ObjectFormat): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (entry.mode === "120000") {
      if (!stat.isSymbolicLink()) return false;
      return blobHash(Buffer.from(await readlink(path, "buffer")), format) === entry.blob;
    }
    if (!stat.isFile()) return false;
    const executable = (stat.mode & 0o111) !== 0;
    if (executable !== (entry.mode === "100755")) return false;
    return blobHash(await readFile(path), format) === entry.blob;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
