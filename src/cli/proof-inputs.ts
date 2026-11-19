import { commonDirOf, withStores } from "../core/commit/at-keys-checkout.js";
import { observedModulesMetaKey } from "../core/keys/modules.js";
import {
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../core/keys/observed.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 ("A: every changed file"; row
 * 023-21): what Squeal saw each named test read, for the stop's marks
 * only: its keyed closure in the green checkout and the repository's
 * shared observed rows (reads, module loads, direct marks), a listed
 * folder (`support/`) marking every changed path under it. Help text: a
 * mark never settles a file, and an unmarked file still stops.
 */

/** For each of `refs`, whether Squeal saw it read a path. */
export async function seenReads(
  root: AbsolutePath,
  refs: readonly TestFileRef[],
  loadsOf: (ref: TestFileRef) => readonly RelativePath[],
): Promise<(ref: TestFileRef, path: RelativePath) => boolean> {
  const reads = new Map<string, readonly RelativePath[]>();
  await withStores(commonDirOf(root), async (main) => {
    for (const ref of refs)
      reads.set(testFileId(ref), [
        ...loadsOf(ref),
        ...(main === null ? [] : observedOf(main, ref)),
      ]);
  });
  return (ref, path) =>
    (reads.get(testFileId(ref)) ?? []).some(
      (read) => read === path || (read.endsWith("/") && (read === "./" || path.startsWith(read))),
    );
}

function observedOf(main: Store, ref: TestFileRef): RelativePath[] {
  return [observedMetaKey, observedModulesMetaKey, observedDirectMetaKey].flatMap(
    (key) => readSharedEntries(main, key(ref.project))[ref.path] ?? [],
  );
}
