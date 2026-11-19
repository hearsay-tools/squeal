import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";

/*
 * Spec 023 D5.2, amended 2026-11-19 (the human on issue #247, "A: explain
 * + --with"; "A: stop guessing"; last, after `reviews/wave-14-sixth.md`,
 * "A: every changed file"): when a named test is unchanged between the
 * sides, every file that changed between the two commits (renames as both
 * paths, deletions too), other than the named test files, must be named
 * with `--with` (test code, copied from the test version) or `--source`
 * (product code, each side's code version). Otherwise the file stops
 * before any run: exit 3, the unnamed files listed. No record of what a
 * test used is complete (folder listings, files a config imports, declared
 * inputs, coverage off, child processes); a file that did not change is
 * the same on both sides, so this set is complete by construction. The
 * files Squeal saw the test read are marked, as help only: a mark never
 * settles a file.
 */

/** A named test's changed files while the test itself is unchanged. */
export interface ChangedImports {
  /** Named by neither `--with` nor `--source`: with any, the file does not run. */
  readonly unsettled: readonly RelativePath[];
  /** Named by `--source`: product code, taken from each side's code version. */
  readonly sources: readonly RelativePath[];
  /** Of `unsettled`, those Squeal saw the test read (its keyed closure or recorded reads); help only. */
  readonly read: readonly RelativePath[];
}

export interface ImportsInput {
  readonly refs: readonly TestFileRef[];
  /** The diff `base..HEAD`. */
  readonly changed: ReadonlySet<RelativePath>;
  /** The named files and the `--with` paths. */
  readonly testSide: ReadonlySet<RelativePath>;
  /** The `--source` paths. */
  readonly source: ReadonlySet<RelativePath>;
  /** Whether Squeal saw `ref` read `path` (help only). */
  readonly seen: (ref: TestFileRef, path: RelativePath) => boolean;
}

export interface ImportsAnswer {
  /** Each named file's changed files, by `testFileId`; `null` when it changed itself. */
  readonly imports: ReadonlyMap<string, ChangedImports | null>;
  /** The changed files other than the named ones: what `--source` may name. */
  readonly candidates: readonly RelativePath[];
}

/** Each named file's changed files, split by the flags. */
export function importsOf(input: ImportsInput): ImportsAnswer {
  const named = new Set(input.refs.map((ref) => ref.path));
  const candidates = [...input.changed].filter((path) => !named.has(path)).sort();
  const imports = new Map<string, ChangedImports | null>();
  for (const ref of input.refs) {
    if (input.changed.has(ref.path)) {
      imports.set(testFileId(ref), null);
      continue;
    }
    const unsettled = candidates.filter(
      (path) => !input.testSide.has(path) && !input.source.has(path),
    );
    imports.set(testFileId(ref), {
      unsettled,
      sources: candidates.filter((path) => input.source.has(path)),
      read: unsettled.filter((path) => input.seen(ref, path)),
    });
  }
  return { imports, candidates };
}

/** Whether the file stops (exit 3, nothing run): a changed file neither flag names. */
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
