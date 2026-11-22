import { posix } from "node:path";
import { gitEntryByKind, listedDirectory } from "../keys/observed.js";
import { hasImportGraphTables } from "../store/import-edges.js";
import { connectionOf } from "../store/store.js";
import type { RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { SchedulerContext } from "./context.js";
import { storeClosures } from "./revision.js";

/*
 * Row 023-46 (`tasks/023-46-notes.md`): which misses of a start need no
 * walk. A `test_file_imports` row is written only by a real walk, at the key
 * that walk's closure gave (`recordImportGraph`). A key covers the
 * environment, the test path, the dependency segment and every closure path
 * present here with its bytes; it leaves out a path that is absent here
 * (`encodeSegment` of a `null` hash). The rule a lookup hit is trusted by
 * (B1) and `closureTrust` reads closures by.
 *
 * Review wave-23-third B2: an equal key proves the list's present paths, not
 * its absent ones. The list the start keyed from may be another worktree's,
 * where an import resolved to a file that is absent here (`src/foo.js`); it
 * then lacks the candidates this worktree's walk probes (`src/foo.ts`), and
 * a walk row at that key belongs to a different closure. So a stored walk
 * proves a miss only when the list holds no unresolved import here
 * (`unresolvedHere`): no listed path hashes `null` in this worktree's hash
 * source, the same test that drops a path from the key, except the test
 * file's default snapshot path. That is complete for what the key leaves
 * out. Every other listed path, listing paths included (an absent directory
 * lists as `ABSENT_LISTING`, never `null`), is in the key with its bytes.
 * The default snapshot path is a function of the test path alone, which the
 * key holds, so every walk at the key lists it alike. Any other absent path
 * forces a walk: a resolution candidate, a resolved target another worktree
 * had, an absent manifest, input or observed read, and a snapshot path a
 * `resolveSnapshotPath` moved. Those cost a walk, never a wrong closure.
 */

/** Whether the store holds a walk of a test file at a key; `false` throughout without the walk tables. */
export type WalkedAt = (ref: TestFileRef, key: CheckKey) => boolean;

/** The store's walks, read one point at a time. */
export function storedWalks(context: Pick<SchedulerContext, "store">): WalkedAt {
  let conn: ReturnType<typeof connectionOf>;
  try {
    conn = connectionOf(context.store);
  } catch {
    // A store `openStore` did not open (a test's wrapper) holds no walks it can read.
    return () => false;
  }
  if (!hasImportGraphTables(conn)) return () => false;
  return (ref, key) =>
    conn.get(
      "SELECT 1 AS found FROM test_file_imports WHERE project = ? AND path = ? AND key = ?",
      ref.project,
      ref.path,
      key,
    ) !== null;
}

/** Whether a test file's list holds a path absent here other than its snapshot file. */
export type Unresolved = (ref: TestFileRef, list: readonly RelativePath[]) => boolean;

/** Vitest's default snapshot path of a test file: `<dir>/__snapshots__/<name>.snap`. */
function defaultSnapshotPath(path: RelativePath): RelativePath {
  return posix.join(posix.dirname(path), "__snapshots__", `${posix.basename(path)}.snap`);
}

/** This worktree's unresolved lists, read from the hash source its key index keys with (`WorktreeKeys`). */
export function unresolvedHere(context: Pick<SchedulerContext, "root" | "keys">): Unresolved {
  const hashOf = gitEntryByKind(context.root, (path) => context.keys.cache.hashOf(path));
  const absent = (path: RelativePath) => listedDirectory(path) === null && hashOf(path) === null;
  return (ref, list) => {
    const snapshot = defaultSnapshotPath(ref.path);
    return list.some((path) => path !== snapshot && absent(path));
  };
}

/**
 * `files` split by whether the store proves their key's walk; a file with no
 * key, no closure list or an unresolved path in that list is never proven.
 */
export function provenWalks<F extends { readonly ref: TestFileRef; readonly key: CheckKey | null }>(
  files: readonly F[],
  walkedAt: WalkedAt,
  listOf: (ref: TestFileRef) => readonly RelativePath[] | undefined,
  unresolved: Unresolved,
): { readonly proven: F[]; readonly unproven: F[] } {
  const proven: F[] = [];
  const unproven: F[] = [];
  for (const file of files) {
    const list = listOf(file.ref);
    const isProven =
      file.key !== null &&
      list !== undefined &&
      !unresolved(file.ref, list) &&
      walkedAt(file.ref, file.key);
    (isProven ? proven : unproven).push(file);
  }
  return { proven, unproven };
}

/**
 * The refs of `misses` a start's recheck still walks. The proven ones keep
 * the stored list's closure, as a lookup hit does; their closure rows are
 * written as this worktree's, as their walk would have written them.
 */
export function unprovenWalks(
  context: SchedulerContext,
  misses: readonly { readonly ref: TestFileRef; readonly key: CheckKey | null }[],
): TestFileRef[] {
  const { proven, unproven } = provenWalks(
    misses,
    storedWalks(context),
    (ref) => context.keys.index.closure(ref)?.paths,
    unresolvedHere(context),
  );
  if (proven.length > 0) {
    storeClosures(
      context,
      proven.map((file) => file.ref),
    );
  }
  return unproven.map((file) => file.ref);
}
