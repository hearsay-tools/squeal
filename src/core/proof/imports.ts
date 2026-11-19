import { posix } from "node:path";
import type { RelativePath } from "../types/common.js";
import { importsIn, reachesTestApi, type Tree } from "./import-graph.js";
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
 * No file name settles anything. Third look (`reviews/wave-14-third.md`):
 * an importer is evidence only when its every import, followed at `HEAD`,
 * is accounted for and none reaches a test API; the same holds for the
 * changed file itself. Imports are read by the parsers in
 * `import-graph.ts`, so a comment or a string never counts.
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
  /** The files at `HEAD` that may import `path` (a text search picks them; the parser decides). */
  candidates(path: RelativePath): Promise<readonly RelativePath[]>;
}

/** One changed import, settled as product code or not. */
export async function settle(
  path: RelativePath,
  s: Settling,
): Promise<{ readonly settled: Settled } | { readonly unsettled: Unsettled }> {
  if (s.source.has(path)) return { settled: { path, why: "--source" } };
  const own = await kindOf(path, s, [s.head, s.base]);
  if ("test" in own) return { unsettled: { path, testCode: true, why: own.test } };
  // Review wave-14 third look, 1: a changed file whose own imports are not all accounted for
  // may be test code; nothing settles it.
  if ("unknown" in own) return { unsettled: { path, testCode: false, why: own.unknown } };
  const unknown: string[] = [];
  for (const importer of await s.candidates(path)) {
    if (importer === path) continue;
    // Third look, 2: an import is read by the parser; a text match only picked the candidate.
    if (!(await importsIn(importer, s.head)).local.includes(path)) continue;
    const kind = await kindOf(importer, s, [s.head]);
    if ("none" in kind) return { settled: { path, why: `imported by ${importer}` } };
    if ("unknown" in kind) unknown.push(kind.unknown);
  }
  const why = unknown[0] ?? "no project file that is not test code imports it";
  return { unsettled: { path, testCode: false, why } };
}

/** Whether a file is test code (and why), shown not to be, or unknown (and why). */
type Kind = { readonly test: string } | { readonly none: true } | { readonly unknown: string };

/**
 * Whether `path` is test code at one of `trees`: a test-side or `--with`
 * path, a `conftest.py`, or a file that reaches a test API; shown not to be
 * only when every import it reaches at every tree is accounted for.
 */
async function kindOf(path: RelativePath, s: Settling, trees: readonly Tree[]): Promise<Kind> {
  if (isTestSide(path, s.testSide)) return { test: "test code by its path" };
  if (posix.basename(path) === "conftest.py") return { test: "pytest's conftest.py" };
  let unknown: string | null = null;
  for (const tree of trees) {
    if (!tree.has(path)) continue;
    const reach = await reachesTestApi(path, tree);
    if (reach === "none") continue;
    if ("unknown" in reach) unknown ??= reach.unknown;
    else {
      const via = reach.via.length === 0 ? "" : ` through ${reach.via.join(", ")}`;
      return { test: `imports ${reach.api}${via} at ${tree.commit.slice(0, 9)}` };
    }
  }
  return unknown === null ? { none: true } : { unknown };
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
