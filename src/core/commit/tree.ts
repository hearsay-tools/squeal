import { runGit, splitNul } from "../fs/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../types/index.js";

/** Bounds the one `git ls-tree` of a report, so a stuck git never holds the scheduler. */
export const LS_TREE_TIMEOUT_MS = 30_000;

/**
 * The blob of each file `commit` holds, by path relative to the worktree
 * root: `git ls-tree -r -z --full-tree`. A file hash is the git blob id
 * (spec 001 D3), so these are the hashes the commit's keys are made of. A
 * symlink is its target's blob, as the stat cache hashes it; a submodule
 * (a `commit` entry) is no file and is left out.
 */
export async function committedBlobs(
  root: AbsolutePath,
  commit: string,
): Promise<Map<RelativePath, FileHash>> {
  const args = ["ls-tree", "-r", "-z", "--full-tree", commit];
  const out = await runGit(root, args, { timeoutMs: LS_TREE_TIMEOUT_MS });
  const blobs = new Map<RelativePath, FileHash>();
  for (const entry of splitNul(out)) {
    // `<mode> SP <type> SP <object> TAB <path>`
    const tab = entry.indexOf("\t");
    const [, type, object] = entry.slice(0, tab).split(" ");
    if (tab > 0 && type === "blob" && object !== undefined) blobs.set(entry.slice(tab + 1), object);
  }
  return blobs;
}
