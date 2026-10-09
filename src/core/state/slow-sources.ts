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
 * listed test file's stored closure names, fast or slow, so a `src` file
 * only fast tests import counts for an e2e that reads only the build
 * output; and neither a test file nor under a slow directory (D6; lessons
 * defect 8a) nor selected by a fast test file's declared inputs, its
 * fixtures (lessons defect 18). A doc or a path no closure names is none.
 */
export function artifactSources(
  store: Store,
  keys: readonly TestFileKeyRecord[],
  view: SlowPolicyView,
): (path: RelativePath) => boolean {
  const testFiles = new Set(keys.map((row) => row.testFile.path));
  let closures: ReadonlySet<RelativePath> | undefined;
  const isFastInput = createInputMatcher([
    ...new Set(
      keys
        .filter((row) => !view.isSlow(row.testFile))
        .flatMap((row) => view.artifactFor(row.testFile.path)),
    ),
  ]);
  return (path) => {
    if (isFastInput(path)) return false;
    if (!inheritsAcrossWorktrees({ path, slow: true }, [path], testFiles, view.slowGlobs)) {
      return false;
    }
    // Read only once a changed path gets this far, as a header without one reads none.
    closures ??= listedClosures(store, keys);
    return closures.has(path);
  };
}

/** Every path the stored closures of the listed test files name. */
function listedClosures(store: Store, keys: readonly TestFileKeyRecord[]): Set<RelativePath> {
  const listed = new Set(keys.map((row) => testFileId(row.testFile)));
  return new Set(
    store.testFiles
      .list()
      .filter((record) => listed.has(testFileId(record.testFile)))
      .flatMap((record) => record.closure.paths),
  );
}
