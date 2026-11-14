import { testFileId } from "../core/keys/reverse-index.js";
import { trustedClosureWrites } from "../core/store/write-markers.js";
import type { RelativePath, WorktreeId } from "../core/types/common.js";
import type { CheckKey, TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";

/*
 * Row 011-44: the stored closures a named selection reads for a path the
 * daemon did not answer (`selectNamedFiles`), kept across a wait's polls.
 * Reading every closure is the large read (about 45 MB of JSON in cezar's
 * store on 2026-11-14); a wait reads them again only when the store's
 * closure-write marker moved since (the database's triggers move it on every
 * closure write, whoever writes), and reads them each time while the marker
 * is not to be trusted (`trustedClosureWrites`). Whether a closure is this
 * worktree's (001 D6's rule) is read on
 * each selection, for the files whose closure holds the path only: a key
 * moves without a closure write.
 */

/**
 * One stored closure: the worktree that wrote it, and whether it holds a
 * path. A kept closure builds its path set at its first question; one read
 * for a single selection searches its list, as a set would cost as much.
 */
class StoredClosure {
  readonly updatedBy: WorktreeId;
  readonly #paths: readonly RelativePath[];
  readonly #kept: boolean;
  #set: ReadonlySet<RelativePath> | undefined;

  constructor(updatedBy: WorktreeId, paths: readonly RelativePath[], kept: boolean) {
    this.updatedBy = updatedBy;
    this.#paths = paths;
    this.#kept = kept;
  }

  holds(rel: RelativePath): boolean {
    if (!this.#kept) return this.#paths.includes(rel);
    this.#set ??= new Set(this.#paths);
    return this.#set.has(rel);
  }
}

/** Test files per key read: two parameters each, well under SQLite's limit. */
const KEY_CHUNK = 500;

/** The stored closures of one wait, by test-file id; a selection without a wait makes its own. */
export class StoredClosures {
  #marker: string | null = null;
  #closures: ReadonlyMap<string, StoredClosure> | undefined;

  /** Every stored closure, as of the marker read first; read again only when it moved. */
  read(store: Store): ReadonlyMap<string, StoredClosure> {
    const marker = trustedClosureWrites(store);
    if (this.#closures !== undefined && marker !== null && marker === this.#marker) {
      return this.#closures;
    }
    const closures = new Map<string, StoredClosure>();
    for (const record of store.testFiles.list()) {
      const closure = new StoredClosure(record.updatedBy, record.closure.paths, marker !== null);
      closures.set(testFileId(record.testFile), closure);
    }
    this.#marker = marker;
    this.#closures = closures;
    return closures;
  }
}

/**
 * The rows whose stored closure holds `rel` and is valid for the row's key
 * (`selectNamedFiles`): this worktree wrote it, or the writer's current key
 * for the file is this worktree's, since a key covers every closure path and
 * its content (task 001-94). The writers' keys are read for those rows only.
 */
export function storedReaders(
  store: Store,
  worktreeId: WorktreeId,
  rows: readonly TestFileKeyRecord[],
  closures: ReadonlyMap<string, StoredClosure>,
  rel: RelativePath,
): TestFileKeyRecord[] {
  const holding = rows.filter((row) => closures.get(testFileId(row.testFile))?.holds(rel) === true);
  const writerOf = (row: TestFileKeyRecord) =>
    closures.get(testFileId(row.testFile))?.updatedBy ?? worktreeId;
  const keys = writerKeys(
    store,
    holding.filter((row) => row.key !== null && writerOf(row) !== worktreeId),
    writerOf,
  );
  return holding.filter((row) => {
    const writer = writerOf(row);
    if (writer === worktreeId) return true;
    return row.key !== null && row.key === keys.get(writer)?.get(testFileId(row.testFile));
  });
}

/** Each writer's current key of the rows it wrote the closure of, by test-file id. */
function writerKeys(
  store: Store,
  rows: readonly TestFileKeyRecord[],
  writerOf: (row: TestFileKeyRecord) => WorktreeId,
): ReadonlyMap<WorktreeId, ReadonlyMap<string, CheckKey | null>> {
  const files = new Map<WorktreeId, TestFileRef[]>();
  for (const row of rows) {
    const writer = writerOf(row);
    const refs = files.get(writer) ?? [];
    refs.push(row.testFile);
    files.set(writer, refs);
  }
  const keys = new Map<WorktreeId, Map<string, CheckKey | null>>();
  for (const [writer, refs] of files) {
    const byFile = new Map<string, CheckKey | null>();
    for (let i = 0; i < refs.length; i += KEY_CHUNK) {
      for (const r of store.testFileKeys.list(writer, refs.slice(i, i + KEY_CHUNK))) {
        byFile.set(testFileId(r.testFile), r.key);
      }
    }
    keys.set(writer, byFile);
  }
  return keys;
}
