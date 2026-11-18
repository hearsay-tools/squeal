import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "../fs/errors.js";
import { runGit, splitNul } from "../fs/git.js";
import { blobHash, type ObjectFormat } from "../hash/blob.js";
import { readObjectFormat } from "../hash/git-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import { LS_TREE_TIMEOUT_MS, lsTreeArgs } from "./tree.js";

/*
 * Spec 023 D4.7 (row 023-07; the human, 2026-11-17, "Whole-checkout
 * check", after reviews wave-7 to wave-7-third): a checkout is the
 * commit's only when every path the commit tracks is there with the same
 * bytes (Squeal's `blobHash`), the same mode and the same link target.
 * After the install, the whole checkout is compared with the commit's own
 * tree (`git ls-tree` of the commit), never with its index or `HEAD`, so
 * `assume-unchanged`, `skip-worktree` and a moved `HEAD` hide nothing. A
 * per-closure check missed links that resolve outside the tree or are
 * gone; the whole-checkout rule needs no closure. A difference anywhere
 * means nothing that runs there may be stored as the commit's.
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

/** How many files are read at once. */
const PARALLEL = 32;

/**
 * The first path, in the commit's tree order, that the checkout `tree`
 * does not hold as `commit` does: gone, another kind, another mode,
 * other bytes or another link target; `null` when every tracked path
 * matches. `skip` names paths written in on purpose (D5.2's test copies).
 * Row 023-08: `expected` holds paths the checkout must hold otherwise than
 * the commit (a proof side's copies at their test version's mode and
 * blob), over the commit's own and beside them: the side's expected tree.
 * Row 023-11 (D5.3): `hidden` paths (a file, or a folder and all under it)
 * are out of the expected tree: the check holds only while each is absent,
 * and the first one present is the change.
 */
export async function checkoutChange(
  root: AbsolutePath,
  tree: AbsolutePath,
  commit: string,
  skip: ReadonlySet<RelativePath> = new Set(),
  expected: ReadonlyMap<RelativePath, CommitEntry> = new Map(),
  hidden: readonly RelativePath[] = [],
): Promise<RelativePath | null> {
  for (const path of hidden) if (await present(join(tree, path))) return path;
  const all = await commitEntries(root, commit);
  for (const [path, entry] of expected) all.set(path, entry);
  const entries = [...all].filter(([path]) => !skip.has(path) && !isUnder(path, hidden));
  const format = await readObjectFormat(root);
  for (let at = 0; at < entries.length; at += PARALLEL) {
    const batch = entries.slice(at, at + PARALLEL);
    const same = await Promise.all(
      batch.map(([path, entry]) => matches(join(tree, path), entry, format)),
    );
    const first = same.indexOf(false);
    if (first >= 0) return (batch[first] as [RelativePath, CommitEntry])[0];
  }
  return null;
}

/** Whether `path` is one of `folders` or lies under one. */
export function isUnder(path: RelativePath, folders: readonly RelativePath[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
}

/** Whether anything, a dangling link included, is at `path`. */
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
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
