import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { ObservedInputs } from "../types/runner.js";
import { checkIgnored } from "../watcher/git.js";
import { scratchOf } from "./observed.js";

// Row 026-38: proof-only. Kept out of `observed.ts`, which is on the result
// key's validity path; this decides what a remote run's proof weighs and
// changes no key.

/** What `provenObserved` reads of a worktree's keys (`WorktreeKeys`). */
export interface ProofKeys {
  readonly index: {
    closure(testFile: TestFileRef): { readonly paths: readonly RelativePath[] } | undefined;
  };
  observedOf(testFile: TestFileRef): readonly RelativePath[];
  effectiveObserved(testFile: TestFileRef, raw: readonly RelativePath[]): RelativePath[];
}

/**
 * Row 026-38 (#304; review 0.1.662 B1): the paths of one remote run's
 * observation that its reader's key keeps, so the run's proof weighs exactly
 * those. A path the key already holds (the reader's keyed closure or its
 * retained observations) stays, as the record never takes it as growth; a
 * new one is dropped when it is the run's own scratch (`scratchOf`, the
 * written-directory bound `inputsOfReads` applies). Then the reader's
 * applied runtime files go (`effectiveObserved`). Asks Git only when the
 * run wrote a directory and a path is new.
 */
export async function provenObserved(
  keys: ProofKeys,
  root: AbsolutePath,
  observed: ObservedInputs,
): Promise<RelativePath[]> {
  const ref = observed.testFile;
  const known = new Set([...(keys.index.closure(ref)?.paths ?? []), ...keys.observedOf(ref)]);
  const fresh = observed.paths.filter((path) => !known.has(path));
  const written = observed.written ?? [];
  const ignored =
    written.length === 0 || fresh.length === 0
      ? new Set<RelativePath>()
      : await checkIgnored(root, fresh);
  const scratch = scratchOf(written, ignored);
  const kept = observed.paths.filter((path) => known.has(path) || !scratch(path));
  return keys.effectiveObserved(ref, kept);
}
