import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { testFileId } from "../core/keys/index.js";
import type {
  AbsolutePath,
  CheckKey,
  RelativePath,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";

/**
 * The test files named paths select (spec 005 D2), in the worktree's listing
 * order, and the paths that select none, as the worktree names them.
 */
export interface NamedSelection {
  readonly files: readonly TestFileRef[];
  readonly unmatched: readonly string[];
  /** Row 011-27 (gh-39): each of `unmatched`, in its order, with how it was read. */
  readonly unmatchedPaths?: readonly UnmatchedPath[];
  /**
   * The directory the paths were resolved against, relative to the root (`""`
   * the root itself), else absolute: a printed command names its paths from
   * it, since `retry` resolves its arguments against the cwd (review of
   * cand/0.1.231, B1).
   */
  readonly base?: string;
}

/** A path that selects nothing, as given and as resolved (row 011-27, gh-39). */
export interface UnmatchedPath {
  /** `unmatched`'s entry: relative to the root, or as given outside it. */
  readonly resolved: string;
  readonly given: string;
  /** The directory it was resolved against, relative to the root (`""` the root itself), else absolute. */
  readonly base?: string;
  /** The listed test file the same path names from the worktree root, which it never selects. */
  readonly fromRoot?: string;
}

/**
 * Spec 005 D2: "A test-file path selects itself. Any other path selects the
 * test files whose closure holds it, using the stored closure only when it is
 * valid for the file's current key (001 D6's rule)." The stored closure is
 * the newest any worktree wrote; it is this worktree's when this worktree
 * wrote it, or when the writer's current key for the file is this
 * worktree's, since a key covers every closure path and its content (as
 * delivery's `closureFor` reads it, task 001-94). A listed test file's path
 * never reaches the closure lookup, so another test file whose closure holds
 * it through declared inputs or an import is not selected (task 005-67,
 * issue 6). Paths resolve against `cwd`; one outside `root` selects nothing.
 */
export function selectNamedFiles(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): NamedSelection {
  const rows = store.testFileKeys.list(worktreeId);
  // Read only for a path no test file has: every stored closure is a large read (task 011-42).
  let closures: ReturnType<typeof validClosures> | undefined;
  const selected = new Map<string, TestFileRef>();
  const unmatched: UnmatchedPath[] = [];
  for (const path of paths) {
    const rel = worktreePath(root, cwd, path);
    const own = rows.filter((row) => row.testFile.path === rel);
    const hits =
      rel === null
        ? []
        : own.length > 0
          ? own
          : rows.filter((row) => {
              closures ??= validClosures(store, worktreeId, rows);
              return closures.get(row)?.has(rel) === true;
            });
    if (hits.length === 0) unmatched.push(unmatchedOf(root, cwd, path, rel, rows));
    for (const row of hits) selected.set(testFileId(row.testFile), row.testFile);
  }
  const resolved = unmatched.map((p) => p.resolved);
  return {
    files: [...selected.values()],
    unmatched: resolved,
    unmatchedPaths: unmatched,
    base: baseOf(root, cwd),
  };
}

/**
 * Row 011-27 (gh-39): how `path` was read, `rel` its reading from `cwd`:
 * the directory it was resolved against and, for a relative path given
 * below the root, the listed test file the same path names from the root.
 */
function unmatchedOf(
  root: AbsolutePath,
  cwd: AbsolutePath,
  path: string,
  rel: RelativePath | null,
  rows: readonly TestFileKeyRecord[],
): UnmatchedPath {
  const own = { resolved: rel ?? path, given: path, base: baseOf(root, cwd) };
  if (isAbsolute(path) || own.base === "") return own;
  const fromRoot = worktreePath(root, root, path);
  const listed = fromRoot !== null && rows.some((row) => row.testFile.path === fromRoot);
  return listed ? { ...own, fromRoot } : own;
}

/** Each row's stored closure, when it is valid for the row's key (`selectNamedFiles`). */
function validClosures(
  store: Store,
  worktreeId: WorktreeId,
  rows: readonly TestFileKeyRecord[],
): ReadonlyMap<TestFileKeyRecord, ReadonlySet<RelativePath>> {
  const records = new Map(store.testFiles.list().map((r) => [testFileId(r.testFile), r]));
  const keys = new Map<WorktreeId, ReadonlyMap<string, CheckKey | null>>();
  const keyOf = (id: WorktreeId, ref: TestFileRef) => {
    let byFile = keys.get(id);
    if (byFile === undefined) {
      byFile = new Map(store.testFileKeys.list(id).map((r) => [testFileId(r.testFile), r.key]));
      keys.set(id, byFile);
    }
    return byFile.get(testFileId(ref)) ?? null;
  };
  const closures = new Map<TestFileKeyRecord, ReadonlySet<RelativePath>>();
  for (const row of rows) {
    const record = records.get(testFileId(row.testFile));
    if (record === undefined) continue;
    const own =
      record.updatedBy === worktreeId ||
      (row.key !== null && row.key === keyOf(record.updatedBy, row.testFile));
    if (own) closures.set(row, new Set(record.closure.paths));
  }
  return closures;
}

/**
 * `path` relative to `root` with `/` separators, resolved against `cwd`, or
 * against its real path when `cwd` reaches the worktree through a symlink;
 * `null` outside the worktree.
 */
export function worktreePath(
  root: AbsolutePath,
  cwd: AbsolutePath,
  path: string,
): RelativePath | null {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const rel = relative(root, resolve(base, path));
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (rel !== "" && !outside) return rel.split(sep).join("/");
  }
  return null;
}

/** `cwd` relative to `root` with `/` (`""` the root itself), as `worktreePath` reads it; else `cwd`. */
export function baseOf(root: AbsolutePath, cwd: AbsolutePath): string {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const rel = relative(root, base);
    if (rel === "") return "";
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (!outside) return rel.split(sep).join("/");
  }
  return cwd;
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
