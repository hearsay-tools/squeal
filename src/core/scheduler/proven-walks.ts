import { posix } from "node:path";
import { inflateRawSync } from "node:zlib";
import { gitEntryByKind, listedDirectory } from "../keys/observed.js";
import { hasImportGraphTables } from "../store/import-edges.js";
import { connectionOf } from "../store/store.js";
import type { RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { SchedulerContext } from "./context.js";
import { storeClosures } from "./revision.js";
import type { WalkEntry } from "./stored-affected.js";

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
 * a walk row at that key belongs to a different closure. So a walk at the
 * key proves a miss only with one of two more facts (option B, coordinator
 * 2026-11-22; the argument and its limits: `tasks/023-46-notes.md`, Round 4):
 *
 * - The list holds no path absent here (`unresolvedHere`: `null` in the hash
 *   source the key index keys with; listing paths never are), except the
 *   test file's default snapshot path, a function of the test path alone.
 *   Then the key holds every listed path with its bytes.
 * - Or its writer walked it at this key (`writerWalked`): the stored list
 *   is within the one keyed here, the worktree that wrote it holds this key
 *   for the file, so its present paths and bytes were these and the paths
 *   absent here were absent there; and no stored walk of the file read a
 *   path absent here as a module, which a writer between its list write and
 *   its ledger commit, still at its previous key, would show.
 *
 * Anything else is walked: a walk costs time, never a wrong closure.
 */

/** The store's walks of test files; nothing throughout without the walk tables. */
export interface StoredWalks {
  /** Whether the store holds a walk of `ref` at `key`. */
  at(ref: TestFileRef, key: CheckKey): boolean;
  /** Every path a stored walk of `ref` read as a module or named as an import target. */
  walkedPaths(ref: TestFileRef): ReadonlySet<RelativePath>;
}

const NO_WALKS: StoredWalks = { at: () => false, walkedPaths: () => new Set() };

/** The store's walks, read one test file at a time. */
export function storedWalks(context: Pick<SchedulerContext, "store">): StoredWalks {
  let conn: ReturnType<typeof connectionOf>;
  try {
    conn = connectionOf(context.store);
  } catch {
    // A store `openStore` did not open (a test's wrapper) holds no walks it can read.
    return NO_WALKS;
  }
  if (!hasImportGraphTables(conn)) return NO_WALKS;
  return {
    at: (ref, key) =>
      conn.get(
        "SELECT 1 AS found FROM test_file_imports WHERE project = ? AND path = ? AND key = ?",
        ref.project,
        ref.path,
        key,
      ) !== null,
    walkedPaths: (ref) => {
      const out = new Set<RelativePath>();
      const rows = conn.all(
        "SELECT imports FROM test_file_imports WHERE project = ? AND path = ?",
        ref.project,
        ref.path,
      );
      for (const row of rows) {
        const entries = JSON.parse(
          inflateRawSync(row.imports as Uint8Array).toString("utf8"),
        ) as WalkEntry[];
        for (const [path, statics, dynamics] of entries) {
          out.add(path);
          for (const target of statics) out.add(target);
          for (const target of dynamics) out.add(target);
        }
      }
      return out;
    },
  };
}

/** The paths of a test file's list absent here, its default snapshot path left out. */
export type Unresolved = (ref: TestFileRef, list: readonly RelativePath[]) => RelativePath[];

/** Vitest's default snapshot path of a test file: `<dir>/__snapshots__/<name>.snap`. */
function defaultSnapshotPath(path: RelativePath): RelativePath {
  return posix.join(posix.dirname(path), "__snapshots__", `${posix.basename(path)}.snap`);
}

/** This worktree's unresolved paths, read from the hash source its key index keys with (`WorktreeKeys`). */
export function unresolvedHere(context: Pick<SchedulerContext, "root" | "keys">): Unresolved {
  const hashOf = gitEntryByKind(context.root, (path) => context.keys.cache.hashOf(path));
  const absent = (path: RelativePath) => listedDirectory(path) === null && hashOf(path) === null;
  return (ref, list) => {
    const snapshot = defaultSnapshotPath(ref.path);
    return list.filter((path) => path !== snapshot && absent(path));
  };
}

/**
 * Whether the list's writer walked it at `key`: the stored list is within the
 * one keyed here, the worktree that wrote it holds `key` for the file, and
 * no stored walk of the file read an `unresolved` path as a module.
 */
export type WriterWalked = (
  ref: TestFileRef,
  key: CheckKey,
  list: readonly RelativePath[],
  unresolved: readonly RelativePath[],
) => boolean;

/** The writer test over the store's closure lists, key rows and walks. */
export function writerWalked(
  context: Pick<SchedulerContext, "store">,
  walks: StoredWalks,
): WriterWalked {
  const { store } = context;
  return (ref, key, list, unresolved) => {
    const record = store.testFiles.get(ref);
    // The list keyed here is the stored one plus this worktree's declared inputs, observed
    // reads and glob folders (`WorktreeKeys.setClosure`); a list rewritten since is not it.
    if (record === null || !within(record.closure.paths, list)) return false;
    const [row] = store.testFileKeys.list(record.updatedBy, [ref]);
    if (row?.key !== key) return false;
    const walked = walks.walkedPaths(ref);
    return !unresolved.some((path) => walked.has(path));
  };
}

function within(paths: readonly RelativePath[], list: readonly RelativePath[]): boolean {
  const listed = new Set(list);
  return paths.every((path) => listed.has(path));
}

/** How a start proves a miss's walk (`provenWalks`). */
export interface WalkProof {
  readonly walks: StoredWalks;
  readonly listOf: (ref: TestFileRef) => readonly RelativePath[] | undefined;
  readonly unresolved: Unresolved;
  readonly writer: WriterWalked;
}

/**
 * `files` split by whether the store proves their key's walk: a walk at the
 * key, and a list with no unresolved path or one its writer walked at that
 * key. A file with no key or no list is never proven.
 */
export function provenWalks<F extends { readonly ref: TestFileRef; readonly key: CheckKey | null }>(
  files: readonly F[],
  proof: WalkProof,
): { readonly proven: F[]; readonly unproven: F[] } {
  const proven: F[] = [];
  const unproven: F[] = [];
  const proves = (ref: TestFileRef, key: CheckKey | null): boolean => {
    const list = proof.listOf(ref);
    if (key === null || list === undefined || !proof.walks.at(ref, key)) return false;
    const unresolved = proof.unresolved(ref, list);
    return unresolved.length === 0 || proof.writer(ref, key, list, unresolved);
  };
  for (const file of files) (proves(file.ref, file.key) ? proven : unproven).push(file);
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
  const walks = storedWalks(context);
  const { proven, unproven } = provenWalks(misses, {
    walks,
    listOf: (ref) => context.keys.index.closure(ref)?.paths,
    unresolved: unresolvedHere(context),
    writer: writerWalked(context, walks),
  });
  if (proven.length > 0) {
    storeClosures(
      context,
      proven.map((file) => file.ref),
    );
  }
  return unproven.map((file) => file.ref);
}
