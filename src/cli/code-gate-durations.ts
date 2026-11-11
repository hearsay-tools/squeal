import { resolveCommonDir } from "../core/fs/git-layout.js";
import { durationOf } from "../core/scheduler/files.js";
import { Connection } from "../core/store/connection.js";
import { openReadOnly } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import { SCHEMA_VERSION } from "../core/store/schema.js";
import { createStore } from "../core/store/store.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 020 D17 (row 020-17ab): each selected test file's stored duration,
 * for the estimate (D17.1) and the order (D17.2) of `squeal code --base`.
 * It is the whole file's time as a daemon last ran it, from any worktree and
 * at any key (`durationOf` of the file's newest results): a selected file
 * loads changed bytes, so its key at the head holds nothing yet. The main
 * store is opened read-only; nothing is written.
 */

export interface StoredDurations {
  /** `CollectOptions.durations`: a file's seconds, `null` when the store holds none. */
  readonly of: (ref: TestFileRef) => number | null;
  close(): void;
}

/**
 * The durations the main store of `root`'s repository holds, read-only;
 * `null` when it is missing, cannot be read, or has another schema than
 * this Squeal's. A file whose read fails has none.
 */
export function storedDurations(root: AbsolutePath): StoredDurations | null {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  const paths = storePaths(commonDir);
  const db = openReadOnly(paths.database, SCHEMA_VERSION);
  if (db === null || db === "missing") return null;
  const store = createStore(new Connection(db), SCHEMA_VERSION, paths);
  const of = (ref: TestFileRef) => {
    try {
      const ms = durationOf(store.results.newestForTestFile(ref));
      return ms === null ? null : ms / 1000;
    } catch {
      return null;
    }
  };
  return { of, close: () => store.close() };
}
