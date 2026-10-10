import { POLICY_FILE } from "../daemon/policy.js";
import { createInputMatcher } from "../keys/glob.js";
import { testFileId } from "../keys/index.js";
import { inheritsAcrossWorktrees } from "../slow/inherit.js";
import type {
  FileHash,
  RelativePath,
  RevisionNumber,
  Store,
  TestFileKeyRecord,
  WorktreeId,
} from "../types/index.js";
import type { SlowPolicyView } from "./slow.js";

/*
 * Spec 004 D8: whether "sources changed since" the slow tier's current
 * results, read from the revisions and the stored closures.
 */

/**
 * Whether a source the artifact could be built from holds other bytes at
 * `revision` than at `since`: a path no artifact glob matches that
 * `isSource` admits (`artifactSources`), nor Squeal's own policy file.
 * Each path's hash before its first change after `since` is compared with
 * its hash after its last, so a revert to the tested bytes and a file made
 * and removed since change nothing (lessons defect 15). Every revision's
 * adds count once a closure names them, whatever found them (review wave 4
 * B4, wave 4.5 B2): a worktree's first listing makes no revision, since the
 * start walk seeds the files beneath linked directories as bootstrap seeds
 * git's (task 001-166; lessons defect 8d).
 */
export function sourcesChanged(
  store: Store,
  worktreeId: WorktreeId,
  since: RevisionNumber,
  revision: RevisionNumber,
  artifact: readonly string[],
  isSource: (path: RelativePath) => boolean,
): boolean {
  if (since >= revision) return false;
  const tested = new Map<RelativePath, FileHash | null>();
  const now = new Map<RelativePath, FileHash | null>();
  for (const { changes } of store.revisions.range(worktreeId, since, revision)) {
    for (const change of changes) {
      if (!tested.has(change.path)) tested.set(change.path, change.oldHash);
      now.set(change.path, change.newHash);
    }
  }
  const isArtifact = createInputMatcher(artifact);
  return [...now].some(
    ([path, hash]) =>
      hash !== tested.get(path) && path !== POLICY_FILE && !isArtifact(path) && isSource(path),
  );
}

/**
 * Whether a path is a source the artifact could be built from: one some
 * listed test file's stored closure names, fast or slow, where that file's
 * own declared inputs do not select it, so a `src` file only fast tests
 * import counts for an e2e that reads only the build output; and neither a
 * test file nor under a slow directory (D6; lessons defect 8a). A stored
 * closure merges imports with declared inputs, so a fixture only the tests
 * declaring it name is none (lessons defect 18), while a broad declaration
 * of every `src` file hides no path another file loads (review wave 6, S1).
 * A doc or a path no closure names is none.
 */
export function artifactSources(
  store: Store,
  keys: readonly TestFileKeyRecord[],
  view: SlowPolicyView,
): (path: RelativePath) => boolean {
  const testFiles = new Set(keys.map((row) => row.testFile.path));
  let closures: ReadonlySet<RelativePath> | undefined;
  return (path) => {
    if (!inheritsAcrossWorktrees({ path, slow: true }, [path], testFiles, view.slowGlobs)) {
      return false;
    }
    // Read only once a changed path gets this far, as a header without one reads none.
    closures ??= undeclaredClosures(store, keys, view);
    return closures.has(path);
  };
}

/** Every path a listed test file's stored closure names that its own declared inputs do not select. */
function undeclaredClosures(
  store: Store,
  keys: readonly TestFileKeyRecord[],
  view: SlowPolicyView,
): Set<RelativePath> {
  const listed = new Set(keys.map((row) => testFileId(row.testFile)));
  const paths = new Set<RelativePath>();
  for (const record of store.testFiles.list()) {
    if (!listed.has(testFileId(record.testFile))) continue;
    const declared = createInputMatcher(view.artifactFor(record.testFile.path));
    for (const path of record.closure.paths) if (!declared(path)) paths.add(path);
  }
  return paths;
}
