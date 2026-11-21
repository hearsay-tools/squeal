import type { WhileOpen } from "../core/commit/at-keys-checkout.js";
import { runGit } from "../core/fs/git.js";
import { createDeclaredInputs } from "../core/keys/closure.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";

/*
 * Row 023-35, review wave-20 B5: the change selects by `<commit>..HEAD`,
 * so a file it did not select may still read a path the working tree
 * changes since HEAD (staged, unstaged or untracked). Before the report
 * says the commit cannot change such a file's result, this asks the
 * commit's open adapters which test files those paths reach, as the
 * selection asks of the committed diff: by path, by a declared input, or
 * by the runner's `affected` (imports, and a project's config or setup).
 */

/** The test files, by `testFileId`, the working tree's uncommitted paths reach; `"all"` when git could not tell. */
export type Reached = ReadonlySet<string> | "all";

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

/** While the checkout's adapters are open: the test files `paths` reach (`"all"` when `paths` is `null`). */
export async function reachedBy(
  paths: readonly RelativePath[] | null,
  { adapters, policy }: Parameters<WhileOpen>[0],
): Promise<Reached> {
  if (paths === null) return "all";
  const ids = new Set<string>();
  if (paths.length === 0) return ids;
  const named = new Set(paths);
  const declared = createDeclaredInputs(policy.inputs, paths);
  try {
    for (const adapter of adapters) {
      for (const ref of await adapter.testFiles())
        if (named.has(ref.path) || declared.for(ref.path).length > 0) ids.add(testFileId(ref));
      const affected = await adapter.affected(paths);
      for (const ref of [...affected.direct, ...affected.transitive]) ids.add(testFileId(ref));
    }
  } catch {
    // An adapter that cannot answer vouches for nothing.
    return "all";
  }
  return ids;
}
