import { posix } from "node:path";
import type { RelativePath } from "../types/common.js";
import { reachesTestApi, resolveLocal, specifiersOf, type Tree } from "./import-graph.js";
import { isTestSide } from "./sides.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 twice (the human on issue #247, "A:
 * explain + --with"; then after `reviews/wave-14-rereview.md` B1, "A: stop
 * when unsure"; row 023-21): a named test unchanged in `base..HEAD` while
 * files its closure imports (directly or not, added ones too) changed. A
 * changed import on the test side (`isTestSide`, named and `--with` paths
 * included) is copied from the test version already. A code-side one is
 * product code, compared as source, only when Squeal can show it: a
 * `--source` path, or a file that at least one project file that is not
 * test code imports at `HEAD`. Every other changed import stops the file:
 * exit 3, named, with the `--with` and `--source` reruns. Test code is a
 * test-side path, a `--with` path, a `conftest.py`, or a file that
 * imports a test API directly or through local imports (`reachesTestApi`).
 * No file name settles anything.
 */

/** A changed import the proof did not settle: the file does not run. */
export interface Unsettled {
  readonly path: RelativePath;
  /** It is test code by its own imports or name (`conftest.py`): `--with` is its rerun. */
  readonly testCode: boolean;
  /** `imports vitest through support/api.ts at <sha>`, or why nothing settles it. */
  readonly why: string;
}

/** A changed import settled as product code. */
export interface Settled {
  readonly path: RelativePath;
  /** `imported by src/main.ts`, or `--source`. */
  readonly why: string;
}

/** A named test's changed code-side imports while the test itself is unchanged. */
export interface ChangedImports {
  /** Not settled: with any, the file does not run. */
  readonly unsettled: readonly Unsettled[];
  /** Settled as product code: the case compares them, or runs them at `HEAD` on both sides. */
  readonly sources: readonly Settled[];
  /** A changed import on the test side (named, `--with`, or by `isTestSide`), copied already. */
  readonly testSide: boolean;
}

/**
 * The code-side paths of `file`'s closure `loads` that `changed` (the diff
 * `base..HEAD`) holds, when `file` itself is unchanged; empty otherwise.
 * `testSide` holds the named files and the `--with` paths.
 */
export function codeSideChanges(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
): { readonly code: RelativePath[]; readonly testSide: boolean } {
  if (changed.has(file)) return { code: [], testSide: false };
  const touched = [...new Set(loads)].filter((path) => path !== file && changed.has(path)).sort();
  const code = touched.filter((path) => !isTestSide(path, testSide));
  return { code, testSide: code.length < touched.length };
}

/** What settles one changed import: the call's flags and the trees at `HEAD` and at `base`. */
export interface Settling {
  /** The named files and the `--with` paths: test code. */
  readonly testSide: ReadonlySet<RelativePath>;
  /** The `--source` paths: product code. */
  readonly source: ReadonlySet<RelativePath>;
  readonly head: Tree;
  readonly base: Tree;
  /** The files at `HEAD` that may import `path` (a cheap text search; each is checked). */
  candidates(path: RelativePath): Promise<readonly RelativePath[]>;
}

/** One changed import, settled as product code or not. */
export async function settle(
  path: RelativePath,
  s: Settling,
): Promise<{ readonly settled: Settled } | { readonly unsettled: Unsettled }> {
  if (s.source.has(path)) return { settled: { path, why: "--source" } };
  const test = await testCodeWhy(path, s, [s.head, s.base]);
  if (test !== null) return { unsettled: { path, testCode: true, why: test } };
  const unknown: string[] = [];
  for (const importer of await s.candidates(path)) {
    if (importer === path) continue;
    const text = await s.head.text(importer);
    if (text === null || !imports(importer, text, path, s.head)) continue;
    const why = await testCodeWhy(importer, s, [s.head]);
    if (why === null) return { settled: { path, why: `imported by ${importer}` } };
    if (why === TOO_MANY) unknown.push(importer);
  }
  const why =
    unknown.length > 0
      ? `its importers' own imports are too many to follow: ${unknown.join(", ")}`
      : "no project file that is not test code imports it";
  return { unsettled: { path, testCode: false, why } };
}

const TOO_MANY = "its local imports are too many to follow";

/**
 * Why `path` is test code at one of `trees`: a test-side or `--with` path,
 * a `conftest.py`, or a test API it reaches; `TOO_MANY` when its imports
 * could not all be followed; `null` when it is not.
 */
async function testCodeWhy(
  path: RelativePath,
  s: Settling,
  trees: readonly Tree[],
): Promise<string | null> {
  if (isTestSide(path, s.testSide)) return "test code by its path";
  if (posix.basename(path) === "conftest.py") return "pytest's conftest.py";
  let unknown = false;
  for (const tree of trees) {
    if (!tree.has(path)) continue;
    const reach = await reachesTestApi(path, tree);
    if (reach === "unknown") unknown = true;
    else if (reach !== "none") {
      const via = reach.via.length === 0 ? "" : ` through ${reach.via.join(", ")}`;
      return `imports ${reach.api}${via} at ${tree.commit.slice(0, 9)}`;
    }
  }
  return unknown ? TOO_MANY : null;
}

/** Whether `importer`'s text names `path` through a local import. */
function imports(importer: RelativePath, text: string, path: RelativePath, tree: Tree): boolean {
  return specifiersOf(importer, text).some(
    (specifier) => resolveLocal(importer, specifier, (p) => tree.has(p)) === path,
  );
}

/**
 * Whether the file stops (exit 3, nothing run): a changed code-side
 * import was not settled as product code while the test did not change.
 */
export function stops(imports: ChangedImports | null): boolean {
  return imports !== null && imports.unsettled.length > 0;
}

/** The `--with` or `--source` paths outside `known`: each reads a warning, not an error. */
export function unusedPaths(
  paths: readonly RelativePath[],
  known: readonly (readonly RelativePath[])[],
): RelativePath[] {
  const all = new Set(known.flat());
  return paths.filter((path) => !all.has(path));
}
