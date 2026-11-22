import { runGit } from "../core/fs/git.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";

/*
 * Row 023-35, review wave-20 B5: the change selects by `<commit>..HEAD`,
 * so a file it did not select may still read a path the working tree
 * changes since HEAD (staged, unstaged or untracked): those paths.
 * Row 023-41 removed `reachedBy`, the in-call run's reach over them;
 * `status-at-call-sides.ts` reads them.
 */

/** The paths the working tree changes since HEAD: staged, unstaged and untracked; `null` when git fails. */
export async function uncommitted(root: AbsolutePath): Promise<RelativePath[] | null> {
  try {
    const tracked = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]);
    const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const paths = `${tracked}\0${untracked}`.split("\0").filter((path) => path !== "");
    return [...new Set(paths)];
  } catch {
    return null;
  }
}
