import { isHelperPath } from "../reach/names.js";
import type { RelativePath } from "../types/common.js";
import { isTestSide } from "./sides.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 (the human on issue #247, "A: explain
 * + --with"; row 023-21): a named test that is unchanged in `base..HEAD`
 * while files its closure imports changed. A changed import on the test
 * side (`isTestSide`, `--with` paths included) is copied with the test
 * version already. The others are code-side: a helper by its folder or
 * name (`isHelperPath`: `*.testkit.*`, `testing/`, `mocks/` and the like)
 * is a `--with` candidate, since Squeal knows no project's source roots;
 * the rest are source the proof compares. Nothing is copied on a guess:
 * the report names both groups.
 */

/** A named test's changed imports while the test itself is unchanged. */
export interface ChangedImports {
  /** Code-side helpers by name: the `--with` candidates. With any, the file does not run. */
  readonly helpers: readonly RelativePath[];
  /** The other code-side changed imports: source the case compares, or runs at `HEAD` on both sides. */
  readonly sources: readonly RelativePath[];
  /** A changed import on the test side (named, `--with`, or by `isTestSide`), copied already. */
  readonly testSide: boolean;
}

/**
 * The changed imports of `file` from its closure `loads` and the diff
 * `changed`; `null` when `file` itself changed or no code-side import
 * did. `testSide` holds the named files and the `--with` paths.
 */
export function changedImports(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
): ChangedImports | null {
  if (changed.has(file)) return null;
  const touched = [...new Set(loads)].filter((path) => path !== file && changed.has(path)).sort();
  const code = touched.filter((path) => !isTestSide(path, testSide));
  if (code.length === 0) return null;
  return {
    helpers: code.filter(isHelperPath),
    sources: code.filter((path) => !isHelperPath(path)),
    testSide: code.length < touched.length,
  };
}

/**
 * Whether the file stops (exit 3, nothing run): a code-side helper
 * changed while the test did not. Without one the file runs; with only
 * source changes and no test-side change, the report notes what it
 * compares as source.
 */
export function stops(imports: ChangedImports | null): boolean {
  return imports !== null && imports.helpers.length > 0;
}

/** The `--with` paths no named test's closure loads: each reads a warning, not an error. */
export function unusedWith(
  withPaths: readonly RelativePath[],
  loads: readonly (readonly RelativePath[])[],
): RelativePath[] {
  const loaded = new Set(loads.flat());
  return withPaths.filter((path) => !loaded.has(path));
}
