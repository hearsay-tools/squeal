import { runGit, splitNul } from "../fs/index.js";
import type { HeadState } from "../revision/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";

/**
 * `HEAD` and the dirty flag recorded with a revision. Spec 001 D2: "the
 * revision records [...] `HEAD`, and whether the tree is dirty." Dirty means
 * any change git status reports, untracked files included. Neither command
 * takes optional locks. The same status gives the unmerged paths, for the
 * merge hold (011 C2 and C9 as amended 2026-10-21, row 011-72).
 */
export async function readHead(root: AbsolutePath): Promise<HeadState> {
  const [sha, status] = await Promise.all([
    // Exit 1: unborn `HEAD`, no commit yet.
    runGit(root, ["rev-parse", "--verify", "-q", "HEAD"], { okCodes: [0, 1] }),
    runGit(root, [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=all",
    ]),
  ]);
  const head = sha.trim();
  const entries = splitNul(status);
  return {
    head: head === "" ? null : head,
    dirty: entries.length > 0,
    unmerged: unmergedPaths(entries),
  };
}

/** git-status(1), "Short Format": the seven codes of an unmerged path. */
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * The unmerged paths of `git status --porcelain=v1 -z` entries, in git's
 * order. An entry is `XY <path>`; a rename or copy's source follows it as a
 * field of its own.
 */
export function unmergedPaths(entries: readonly string[]): RelativePath[] {
  const paths: RelativePath[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    const code = entry.slice(0, 2);
    if (UNMERGED.has(code)) paths.push(entry.slice(3));
    else if (/[RC]/.test(code)) i += 1;
  }
  return paths;
}
