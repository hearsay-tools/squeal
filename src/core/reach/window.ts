import type { RelativePath } from "../types/common.js";
import type { ReachEdit, ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 015 D11: the window's edits as the report counts them. A path other
 * worktrees edited that this one does not have costs nothing here
 * (015-122). Row 015-128 adds what the edits re-ran in all, the base of
 * every edit share.
 */

export function windowEdits(snapshot: ReachSnapshot): {
  /** The window's edits, each of the paths this worktree has; an edit of none is left out. */
  readonly kept: readonly ReachEdit[];
  /** Per path, the edits that changed it. */
  readonly edits: ReadonlyMap<RelativePath, number>;
  /** Per path, the indexes in `kept` of the edits that changed it. */
  readonly editsOf: ReadonlyMap<RelativePath, readonly number[]>;
} {
  const kept = snapshot.edits.flatMap((edit) => {
    const paths = [...new Set(edit.paths)].filter((p) => snapshot.modules.hasBytes(p));
    return paths.length === 0 ? [] : [{ at: edit.at, paths }];
  });
  const edits = new Map<RelativePath, number>();
  const editsOf = new Map<RelativePath, number[]>();
  for (const [at, edit] of kept.entries()) {
    for (const path of edit.paths) {
      edits.set(path, (edits.get(path) ?? 0) + 1);
      const known = editsOf.get(path);
      if (known === undefined) editsOf.set(path, [at]);
      else known.push(at);
    }
  }
  return { kept, edits, editsOf };
}

/**
 * The seconds the window's edits re-ran: per edit, the union of the
 * suite's test files the edited files reach and the edited test files
 * themselves, each test file once.
 */
export function rerunSeconds(
  kept: readonly ReachEdit[],
  reaches: ReadonlyMap<RelativePath, { readonly reach: readonly number[] }>,
  suite: readonly ReachTestFile[],
): number {
  const indexOf = new Map(suite.map((t, i) => [t.ref.path, i]));
  let total = 0;
  for (const edit of kept) {
    const rerun = new Set<number>();
    for (const path of edit.paths) {
      for (const index of reaches.get(path)?.reach ?? []) rerun.add(index);
      const own = indexOf.get(path);
      if (own !== undefined) rerun.add(own);
    }
    for (const index of rerun) total += suite[index]?.seconds ?? 0;
  }
  return total;
}
