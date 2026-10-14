import { isAbsolute, join, relative, resolve } from "node:path";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import type { TestCommand } from "./test-command.js";
import type { PytestCommand } from "./test-command-pytest.js";

/**
 * Spec 005 D8 step 2: the test files `command` would run, from Squeal's own
 * listing of the worktree (`listing`, every test file of every project), or
 * `null` when they cannot be resolved completely. The command runs from
 * `root`. `nodeTest` names the listing's node:test and pytest projects; the
 * rest are Vitest's. `omitted` counts the test files the listing left out because
 * Squeal does not run them, `null` when the daemon recorded no count.
 *
 * A Vitest command resolves only while the listing has one Vitest project:
 * the store keeps no project's own directory, which Vitest's filter rule is
 * relative to, so a second project could have one other than the root. Nor
 * while the listing left a file out (task 005-26): the command would run it,
 * and its path is not known to match a filter against.
 */
export function resolveTestFiles(
  command: TestCommand,
  listing: readonly TestFileRef[],
  root: AbsolutePath,
  nodeTest: ReadonlySet<string>,
  omitted: number | null,
): readonly TestFileRef[] | null {
  if (command.runner === "node-test") {
    const own = listing.filter((ref) => ref.project === command.project);
    if (command.files === null) return own.length === 0 ? null : own;
    const byPath = new Map(own.map((ref) => [ref.path, ref]));
    const files = command.files.map((file) => byPath.get(worktreePath(root, file) ?? ""));
    return files.every((ref) => ref !== undefined) ? unique(files) : null;
  }
  if (command.runner === "pytest") return pytestFiles(command, listing, root);
  if (omitted !== 0) return null;
  const vitest = listing.filter((ref) => !nodeTest.has(ref.project));
  if (new Set(vitest.map((ref) => ref.project)).size !== 1) return null;
  if (command.filters.length === 0) return vitest;
  const selected = new Set<TestFileRef>();
  for (const filter of command.filters) {
    const hits = vitest.filter((ref) => matchesFilter(join(root, ref.path), filter, root));
    if (hits.length === 0) return null;
    for (const ref of hits) selected.add(ref);
  }
  return vitest.filter((ref) => selected.has(ref));
}

/**
 * Vitest's filename filter rule (`TestProject.filterFiles`), with the
 * project's directory and the process's working directory both `root`: a
 * filter matches a test file whose path relative to the directory contains
 * it, or contains the filter taken relative to the directory, ignoring case;
 * an absolute filter also matches every file under it.
 */
export function matchesFilter(file: AbsolutePath, filter: string, root: AbsolutePath): boolean {
  if (isAbsolute(filter) && file.startsWith(filter)) return true;
  const testFile = relative(root, file).toLocaleLowerCase();
  const rel = relative(root, resolve(root, filter));
  const relativePath = filter.endsWith("/") ? join(rel, "/") : rel;
  return (
    testFile.includes(filter.toLocaleLowerCase()) ||
    testFile.includes(relativePath.toLocaleLowerCase())
  );
}

/**
 * Spec 007 D8: a pytest command's files among its project's listed ones,
 * only when every path names one. No path and a directory, the root
 * included, do not resolve: pytest's own discovery would run every test
 * file under them, and Squeal's `include` and `exclude` need not list them
 * all, so the files it holds results for prove nothing about the rest
 * (review 007-19 B4). Nor does a path outside the worktree or naming no
 * listed file.
 */
function pytestFiles(
  command: PytestCommand,
  listing: readonly TestFileRef[],
  root: AbsolutePath,
): readonly TestFileRef[] | null {
  if (command.paths === null) return null;
  const own = listing.filter((ref) => ref.project === command.project);
  const named = new Set(command.paths.map((path) => worktreePath(root, path)));
  if (![...named].every((rel) => own.some((ref) => ref.path === rel))) return null;
  return own.filter((ref) => named.has(ref.path));
}

/** `path` relative to `root` with `/` separators; `null` outside it. */
function worktreePath(root: AbsolutePath, path: string): string | null {
  const rel = relative(root, resolve(root, path));
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  return rel;
}

function unique(files: readonly (TestFileRef | undefined)[]): TestFileRef[] {
  return [...new Set(files as TestFileRef[])];
}
