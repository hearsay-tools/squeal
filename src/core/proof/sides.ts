import type { RelativePath } from "../types/common.js";

/*
 * Spec 023 D5 (row 023-08): a red proof's two sides, and the case the
 * diff and the named test's closure give by default. A side is a pair of
 * versions: the test files' and the code's. 023-08 builds the `source`
 * and `test` cases; `dependency` is row 023-11's.
 */

/** The cases this row builds. */
export type ProofCase = "source" | "test";

/** A side: the commit its test files come from, and the commit of the code they run over. */
export interface Side {
  readonly tests: string;
  readonly code: string;
}

/** D5's table: the red and green sides of `kind` between `base` and `head`. */
export function sidesOf(kind: ProofCase, base: string, head: string): { red: Side; green: Side } {
  const green = { tests: head, code: head };
  return kind === "source"
    ? { red: { tests: head, code: base }, green }
    : { red: { tests: base, code: head }, green };
}

/**
 * Folder names that hold test-side files: helpers, fixtures, mocks and
 * snapshots beside the tests. Spec 023 D5.2 names "helpers, fixtures,
 * files under the project's test include globs"; runners do not give
 * their include globs, so a folder of one of these names stands for them.
 */
const TEST_FOLDERS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "__mocks__",
  "fixtures",
  "__fixtures__",
  "__snapshots__",
  "testdata",
]);

/** A test file's own name: `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`. */
const TEST_NAME = /(\.(test|spec)\.[^/]+|_test\.[^/.]+|^test_[^/]+\.py)$/;

/**
 * D5.2: whether `path` is on the test side, not the code side: a named
 * test file, a file in a test folder (`TEST_FOLDERS`), or a file with a
 * test file's name.
 */
export function isTestSide(path: RelativePath, named: ReadonlySet<RelativePath>): boolean {
  if (named.has(path)) return true;
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return parts.some((part) => TEST_FOLDERS.has(part)) || TEST_NAME.test(name);
}

/**
 * D5's defaults for one named test: `source` when `changed` (the diff
 * base..HEAD) holds a code-side file its closure `loads`; `test` when it
 * holds only test-side files of it (the test itself among them); `null`
 * when the diff holds none of them.
 */
export function defaultCase(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  named: ReadonlySet<RelativePath>,
): ProofCase | null {
  const touched = [...new Set([file, ...loads])].filter((path) => changed.has(path));
  if (touched.length === 0) return null;
  return touched.some((path) => !isTestSide(path, named)) ? "source" : "test";
}

/** One version's entry for a path: its git mode and blob. */
export interface Entry {
  readonly mode: string;
  readonly blob: string;
}

/**
 * D5.2: the test-side paths the test version holds otherwise than the code
 * version (absent there, or with another mode or blob), the named files
 * among them: what is copied into the side's checkout. Every such path,
 * not only those the test loads: the closure at the test version is only
 * known in the checkout, and a file the test does not load changes neither
 * its key nor its run.
 */
export function testSideCopies(
  tests: ReadonlyMap<RelativePath, Entry>,
  code: ReadonlyMap<RelativePath, Entry>,
  named: ReadonlySet<RelativePath>,
): RelativePath[] {
  const out: RelativePath[] = [];
  for (const [path, entry] of tests) {
    if (!isTestSide(path, named)) continue;
    const there = code.get(path);
    if (there === undefined || there.blob !== entry.blob || there.mode !== entry.mode)
      out.push(path);
  }
  return out.sort();
}

/**
 * D5.2 (human, 2026-11-16, "refuse"): the first code-side path the test's
 * closure in the side's checkout loads that the code version lacks and the
 * test version holds: the test imports a source file the code version
 * does not have. A resolution candidate both versions lack is no import.
 */
export function missingImport(
  loads: readonly RelativePath[],
  tests: ReadonlyMap<RelativePath, Entry>,
  code: ReadonlyMap<RelativePath, Entry>,
  named: ReadonlySet<RelativePath>,
): RelativePath | null {
  for (const path of [...loads].sort()) {
    if (isTestSide(path, named)) continue;
    if (!code.has(path) && tests.has(path)) return path;
  }
  return null;
}
