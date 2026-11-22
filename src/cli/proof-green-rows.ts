import type { KeyedFile } from "../core/commit/at-keys-checkout.js";
import { resultsAt } from "../core/commit/at-keys-checkout.js";
import { compare } from "../core/fs/compare.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";
import { idOf } from "./status-at-after.js";

/*
 * Spec 023 D7.6 (row 023-42): the green side's files as the commit daemon
 * at HEAD keys them, read from the shared store with no keying in the
 * call. Each named path's rows are the daemon's (every project that lists
 * the path, as the temporary checkout's runners listed them), each at its
 * live key with the results stored there. A file's closure, which the case
 * choice and the stop's marks read (D5.2), is the stored one when it holds
 * for the row's key: the daemon wrote it, or its writer's current key for
 * the file is the same key (a key covers every closure path and its bytes,
 * task 001-94), as `storedReaders` rules.
 */

/** The named files the commit daemon of `tree` lists, keyed as its rows key them. */
export function daemonKeyed(
  main: Store | null,
  tree: AbsolutePath,
  named: ReadonlySet<RelativePath>,
): KeyedFile[] {
  if (main === null) return [];
  const id = idOf(tree);
  const rows = main.testFileKeys.list(id).filter((row) => named.has(row.testFile.path));
  return rows.map((row) => ({ ref: row.testFile, at: keyAt(main, row, id) }));
}

function keyAt(main: Store, row: TestFileKeyRecord, id: TestFileKeyRecord["worktreeId"]) {
  const ref = row.testFile;
  if (row.key === null)
    return notDetermined("its commit daemon could not key it (a runner call failed there)");
  const loads = loadsOf(main, ref, row.key, id);
  if (loads === null) return notDetermined("its closure at the commit is not stored for its key");
  return { key: row.key, stored: resultsAt(main, ref, row.key), loads };
}

/** The stored closure's paths when it holds for `key` in the worktree `id`; `null` otherwise. */
function loadsOf(
  main: Store,
  ref: TestFileRef,
  key: NonNullable<TestFileKeyRecord["key"]>,
  id: TestFileKeyRecord["worktreeId"],
): RelativePath[] | null {
  const record = main.testFiles.get(ref);
  if (record === null) return null;
  const writer = record.updatedBy;
  if (writer !== id) {
    const [theirs] = main.testFileKeys.list(writer, [ref]);
    if (theirs?.key !== key) return null;
  }
  return [...record.closure.paths].sort(compare);
}

function notDetermined(detail: string) {
  return { notDetermined: { reason: "unlisted" as const, detail } };
}

/** The live row of each of `refs` in the worktree of `tree`, by `testFileId`. */
export function liveRows(
  main: Store | null,
  tree: AbsolutePath,
  refs: readonly TestFileRef[],
): ReadonlyMap<string, TestFileKeyRecord> {
  if (main === null || refs.length === 0) return new Map();
  const rows = main.testFileKeys.list(idOf(tree), refs);
  return new Map(rows.map((row) => [testFileId(row.testFile), row]));
}
