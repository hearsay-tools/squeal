import { runGit, splitNul } from "../fs/index.js";
import type { HeadState } from "../revision/index.js";
import type { AbsolutePath } from "../types/index.js";

/**
 * `HEAD` and the dirty flag recorded with a revision. Spec 001 D2: "the
 * revision records [...] `HEAD`, and whether the tree is dirty." Dirty means
 * any change git status reports, untracked files included. Neither command
 * takes optional locks.
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
  return { head: head === "" ? null : head, dirty: splitNul(status).length > 0 };
}
