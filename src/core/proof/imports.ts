import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 (the human on issue #247, "A: explain
 * + --with"; last, after the fourth review of row 023-21, "A: stop
 * guessing", `reviews/wave-14-fourth.md`): Squeal does not guess whether a
 * changed import is test or product code. When a named test is unchanged
 * in `base..HEAD`, every changed file its closure loads (directly or
 * through other files, added ones too) stops the file unless `--with` or
 * `--source` names it: exit 3, the files listed, with the exact reruns.
 * No name rule exempts one (`reviews/wave-14-fifth.md` 1): a changed
 * `test/rows.ts` stops like any other. Earlier rules that read test code
 * from names or imports are withdrawn: each review found test code that
 * read as product code and gave a false `proven`. The closure here is the
 * keyed one; `inputs.ts` checks what the runs read after they ran.
 */

/** A named test's changed code-side imports while the test itself is unchanged. */
export interface ChangedImports {
  /** Named by neither `--with` nor `--source`: with any, the file does not run. */
  readonly unsettled: readonly RelativePath[];
  /** Named by `--source`: product code, taken from each side's code version. */
  readonly sources: readonly RelativePath[];
}

export interface ImportsInput {
  readonly refs: readonly TestFileRef[];
  /** Each named file's closure in the green checkout at `HEAD`. */
  readonly loadsOf: (ref: TestFileRef) => readonly RelativePath[];
  /** The diff `base..HEAD`. */
  readonly changed: ReadonlySet<RelativePath>;
  /** The named files and the `--with` paths: copied from the test version. */
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
    const code = changedImports(ref.path, input.loadsOf(ref), input.changed, input.testSide);
    for (const path of code) candidates.add(path);
    imports.set(
      testFileId(ref),
      code.length === 0
        ? null
        : {
            unsettled: code.filter((path) => !input.source.has(path)),
            sources: code.filter((path) => input.source.has(path)),
          },
    );
  }
  return { imports, candidates: [...candidates].sort() };
}

/**
 * The paths of `file`'s closure `loads` that `changed` holds, other than
 * the named files and `--with` paths (`testSide`), when `file` itself is
 * unchanged; empty otherwise. No name rule leaves one out.
 */
export function changedImports(
  file: RelativePath,
  loads: readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  testSide: ReadonlySet<RelativePath>,
): RelativePath[] {
  if (changed.has(file)) return [];
  return [...new Set(loads)].filter((path) => changed.has(path) && !testSide.has(path)).sort();
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
