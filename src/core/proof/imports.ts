import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import { isTestSide } from "./sides.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 (the human on issue #247, "A: explain
 * + --with"; last, after the fourth review of row 023-21, "A: stop
 * guessing", `reviews/wave-14-fourth.md`): Squeal does not guess whether a
 * changed import is test or product code. When a named test is unchanged
 * in `base..HEAD`, every changed file its closure loads (directly or
 * through other files, added ones too) that is not already copied from
 * the test version (a test-side path, `isTestSide`, the named files and
 * the `--with` paths among them) stops the file unless `--source` names
 * it: exit 3, the files listed, with the exact reruns. Earlier rules that
 * read test code from names or imports are withdrawn: each review found
 * test code that read as product code and gave a false `proven`.
 */

/** A named test's changed code-side imports while the test itself is unchanged. */
export interface ChangedImports {
  /** Named by neither `--with` nor `--source`: with any, the file does not run. */
  readonly unsettled: readonly RelativePath[];
  /** Named by `--source`: product code, taken from each side's code version. */
  readonly sources: readonly RelativePath[];
  /** A changed import on the test side (named, `--with`, or by `isTestSide`), copied already. */
  readonly testSide: boolean;
}

export interface ImportsInput {
  readonly refs: readonly TestFileRef[];
  /** Each named file's closure in the green checkout at `HEAD`. */
  readonly loadsOf: (ref: TestFileRef) => readonly RelativePath[];
  /** The diff `base..HEAD`. */
  readonly changed: ReadonlySet<RelativePath>;
  /** The named files and the `--with` paths. */
  readonly testSide: ReadonlySet<RelativePath>;
  /** The `--source` paths. */
  readonly source: ReadonlySet<RelativePath>;
}

export interface ImportsAnswer {
  /** Each named file's changed imports, by `testFileId`; `null` when it changed or none did. */
  readonly imports: ReadonlyMap<string, ChangedImports | null>;
  /** Every changed code-side import of an unchanged named file: what `--source` may name. */
  readonly candidates: readonly RelativePath[];
}

/** Each named file's changed imports, split by `--source`. */
export function importsOf(input: ImportsInput): ImportsAnswer {
  const imports = new Map<string, ChangedImports | null>();
  const candidates = new Set<RelativePath>();
  for (const ref of input.refs) {
    const side = codeSideChanges(ref.path, input.loadsOf(ref), input.changed, input.testSide);
    for (const path of side.code) candidates.add(path);
    imports.set(
      testFileId(ref),
      side.code.length === 0
        ? null
        : {
            unsettled: side.code.filter((path) => !input.source.has(path)),
            sources: side.code.filter((path) => input.source.has(path)),
            testSide: side.testSide,
          },
    );
  }
  return { imports, candidates: [...candidates].sort() };
}

/**
 * The code-side paths of `file`'s closure `loads` that `changed` holds,
 * when `file` itself is unchanged; empty otherwise.
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

/** Whether the file stops (exit 3, nothing run): a changed import neither flag names. */
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
