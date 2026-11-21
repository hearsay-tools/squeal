import { hasImportGraphTables } from "../store/import-edges.js";
import { connectionOf } from "../store/store.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { SchedulerContext } from "./context.js";
import { storeClosures } from "./revision.js";

/*
 * Row 023-46 (`tasks/023-46-notes.md`): which misses of a start need no
 * walk. A `test_file_imports` row is written only by a real walk, at the key
 * that walk's closure gave (`recordImportGraph`). A key covers the
 * environment, the test path, the dependency segment and every present
 * closure path with its bytes, so a file keyed here at such a key has the
 * closure that walk found: walking it again keys it at the same key. This is
 * the rule a lookup hit is trusted by (B1) and `closureTrust` reads closures
 * by.
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

/** `files` split by whether the store proves their key's walk; a file with no key is never proven. */
export function provenWalks<F extends { readonly ref: TestFileRef; readonly key: CheckKey | null }>(
  files: readonly F[],
  walkedAt: WalkedAt,
): { readonly proven: F[]; readonly unproven: F[] } {
  const proven: F[] = [];
  const unproven: F[] = [];
  for (const file of files) {
    (file.key !== null && walkedAt(file.ref, file.key) ? proven : unproven).push(file);
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
  const { proven, unproven } = provenWalks(misses, storedWalks(context));
  if (proven.length > 0) {
    storeClosures(
      context,
      proven.map((file) => file.ref),
    );
  }
  return unproven.map((file) => file.ref);
}
