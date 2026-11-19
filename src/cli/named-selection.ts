import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { selects } from "../core/commit/at-keys-narrow.js";
import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type {
  AbsolutePath,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";
import { listingOf, type SelectionUnlisted } from "./named-listing.js";
import { notRunTestFile } from "./retry-unlisted.js";
import { StoredClosures, storedReaders } from "./stored-closures.js";

/**
 * The test files named paths select (spec 005 D2), in the worktree's listing
 * order, and the paths that select none, as the worktree names them.
 */
export interface NamedSelection {
  readonly files: readonly TestFileRef[];
  readonly unmatched: readonly string[];
  /** Row 011-27 (gh-39): each of `unmatched`, in its order, with how it was read. */
  readonly unmatchedPaths: readonly UnmatchedPath[];
  /**
   * The directory the paths were resolved against, relative to the root (`""`
   * the root itself), else absolute: a printed command names its paths from
   * it, since `retry` resolves its arguments against the cwd (review of
   * cand/0.1.231, B1).
   */
  readonly base?: string;
  /** Row 011-206 (gh-83): each named path, in its order, with how it was read. */
  readonly paths: readonly NamedPath[];
  /**
   * Row 011-401 (gh-242): set by the read that ended a wait or snapshot when
   * the list may be incomplete (`selectionPartial`): the revision Squeal
   * catches up with, `null` when its pass has not said which.
   */
  readonly partial?: { readonly revision: RevisionNumber | null };
  /** Row 023-26 (Q7): with a path that selects nothing, the listing not done (`listingOf`). */
  readonly unlisted?: SelectionUnlisted;
}

/**
 * Row 011-206 (gh-83, 011 C15): one named path. `test-file`, a listed test
 * file, which selects itself; `source`, any other path, which selects the
 * test files that read it; `not-run`, a test file Squeal does not run
 * (`notRunTestFile`), which selects its readers too, whose verdict is not
 * its own; `unmatched`, a path that selects nothing. Row 011-406 (gh-169):
 * `directory`, a real folder in the worktree (`.` the root), which selects
 * the listed test files under it, none when it holds none.
 */
export interface NamedPath {
  /** As `unmatched` names it: relative to the root (`.` the root itself), or as given outside it. */
  readonly path: string;
  readonly kind: "test-file" | "source" | "not-run" | "unmatched" | "directory";
  /** How many test files it selects. */
  readonly selects: number;
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
  /** Row 011-406: a real folder that holds no listed test file. */
  readonly folder?: true;
  /**
   * Row 011-406 (gh-169): for a path that is neither a file nor a folder, the
   * listed test files whose path starts with it, which it never selects.
   */
  readonly startsWith?: readonly string[];
}

/**
 * Spec 005 D2: "A test-file path selects itself. Any other path selects the
 * test files whose closure holds it, using the stored closure only when it is
 * valid for the file's current key (001 D6's rule)." Row 011-234: with
 * `readers`, the daemon's answer to the wait's sync, a path it names selects
 * the listed test files whose closure in the daemon's key index holds it, at
 * the synced revision, whatever another worktree wrote since; a path it does
 * not name reads the stored closures, which `stored` keeps across a wait's
 * polls until a closure is written (row 011-44), and the import walks
 * stored at this worktree's keys, which hold whoever wrote them (row
 * 011-403, `tasks/011-402/notes.md`: 1 of 688 by the closures alone). The stored closure is
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
  readers?: ReadonlyMap<RelativePath, readonly TestFileRef[]>,
  stored: StoredClosures = new StoredClosures(),
): NamedSelection {
  const rows = store.testFileKeys.list(worktreeId);
  const readersOf = (rel: RelativePath): TestFileKeyRecord[] => {
    const named = readers?.get(rel);
    if (named !== undefined) {
      const ids = new Set(named.map(testFileId));
      return rows.filter((row) => ids.has(testFileId(row.testFile)));
    }
    // Read only for a path no test file has: every stored closure is a large read (task 011-42),
    // which a wait's `stored` keeps until a closure is written (row 011-44).
    const closures = storedReaders(store, worktreeId, rows, stored.read(store), rel);
    // Row 011-403: and every walk stored at this worktree's key, whoever wrote it.
    const ids = new Set(
      [...closures, ...stored.walks.readers(store, rows, rel)].map((r) => testFileId(r.testFile)),
    );
    return rows.filter((row) => ids.has(testFileId(row.testFile)));
  };
  const selected = new Map<string, TestFileRef>();
  const unmatched: UnmatchedPath[] = [];
  const named: NamedPath[] = [];
  let policy: Policy | undefined;
  // Row 023-26: the listing not done, whose paths that select nothing get no hint from it.
  const listing = listingOf(store, worktreeId, rows);
  const notRun = (rel: RelativePath) => {
    policy ??= readPolicy(root);
    return notRunTestFile(store, worktreeId, root, rel, rows, policy);
  };
  for (const path of paths) {
    const folder = folderPath(root, cwd, path);
    if (folder !== null) {
      // Row 011-406 (gh-169): a folder selects the listed test files under it, nothing more.
      const under = rows.filter((row) => selects([folder], row.testFile.path));
      const shown = folder === "" ? "." : folder;
      if (under.length === 0) {
        unmatched.push({ resolved: shown, given: path, base: baseOf(root, cwd), folder: true });
      }
      for (const row of under) selected.set(testFileId(row.testFile), row.testFile);
      named.push({ path: shown, kind: "directory", selects: under.length });
      continue;
    }
    const rel = worktreePath(root, cwd, path);
    const own = rows.filter((row) => row.testFile.path === rel);
    const hits = rel === null ? [] : own.length > 0 ? own : readersOf(rel);
    if (hits.length === 0) unmatched.push(unmatchedOf(root, cwd, path, rel, listing ? null : rows));
    for (const row of hits) selected.set(testFileId(row.testFile), row.testFile);
    const kind =
      own.length > 0
        ? "test-file"
        : rel !== null && notRun(rel)
          ? "not-run"
          : hits.length > 0
            ? "source"
            : "unmatched";
    named.push({ path: rel ?? path, kind, selects: hits.length });
  }
  const resolved = unmatched.map((p) => p.resolved);
  return {
    files: [...selected.values()],
    unmatched: resolved,
    unmatchedPaths: unmatched,
    base: baseOf(root, cwd),
    paths: named,
    ...(unmatched.length === 0 || listing === null ? {} : { unlisted: listing }),
  };
}

/**
 * Row 011-234: the named paths that are not listed test files, relative to
 * the root, once each: the paths whose readers a named wait's sync asks of
 * the daemon (`SyncRequest.paths`).
 */
export function sourcePaths(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): RelativePath[] {
  const listed = new Set(store.testFileKeys.list(worktreeId).map((row) => row.testFile.path));
  const sources = new Set<RelativePath>();
  for (const path of paths) {
    const rel = worktreePath(root, cwd, path);
    // Row 011-406: a folder selects by the listing, not by readers.
    if (rel !== null && !listed.has(rel) && folderPath(root, cwd, path) === null) sources.add(rel);
  }
  return [...sources];
}

/**
 * Row 011-27 (gh-39): how `path` was read, `rel` its reading from `cwd`:
 * the directory it was resolved against and, for a relative path given
 * below the root, the listed test file the same path names from the root.
 * Row 011-406 (gh-169): for a path that is not on disk, the listed test
 * files whose path starts with it, as a runner's filename filter reads it.
 * Row 023-26: neither while the listing is not done (`rows` `null`).
 */
function unmatchedOf(
  root: AbsolutePath,
  cwd: AbsolutePath,
  path: string,
  rel: RelativePath | null,
  rows: readonly TestFileKeyRecord[] | null,
): UnmatchedPath {
  const starts =
    rows === null || rel === null || existsAt(root, rel)
      ? []
      : rows.map((row) => row.testFile.path).filter((p) => p.startsWith(rel));
  const own = {
    resolved: rel ?? path,
    given: path,
    base: baseOf(root, cwd),
    ...(starts.length > 0 ? { startsWith: [...new Set(starts)] } : {}),
  };
  if (rows === null || isAbsolute(path) || own.base === "") return own;
  const fromRoot = worktreePath(root, root, path);
  const listed = fromRoot !== null && rows.some((row) => row.testFile.path === fromRoot);
  return listed ? { ...own, fromRoot } : own;
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

/**
 * Row 011-406 (gh-169): `path` relative to `root` with `/` separators when it
 * resolves against `cwd` (or its real path) to a real folder in the worktree,
 * `""` the root itself; else `null`.
 */
export function folderPath(
  root: AbsolutePath,
  cwd: AbsolutePath,
  path: string,
): RelativePath | null {
  for (const base of [cwd, realOrNull(cwd)]) {
    if (base === null) continue;
    const at = resolve(base, path);
    const rel = relative(root, at);
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (!outside && isFolder(at)) return rel.split(sep).join("/");
  }
  return null;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function existsAt(root: AbsolutePath, rel: RelativePath): boolean {
  try {
    statSync(resolve(root, rel));
    return true;
  } catch {
    return false;
  }
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
