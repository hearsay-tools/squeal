import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import { median } from "./estimate.js";

/*
 * Spec 020 D17.2 (row 020-17b): the order the gate gives a runner its files
 * in. A changed path's functions complete together, once every selected
 * file that loads it has (D5), so the files go by changed path: the paths
 * whose loaders cost least first, each with its loaders not given yet. Small
 * paths complete before the budget ends; a path every file loads, a hub,
 * comes last. Nothing here decides when evidence is complete.
 */

/** What the order reads of each file, known before the run. */
export interface OrderInputs {
  /** The sources the file's closure loads; `null` when the runner cannot give it. */
  readonly loads: (ref: TestFileRef) => readonly RelativePath[] | null;
  /** The file's stored seconds; `null` when the stores hold none. */
  readonly seconds: (ref: TestFileRef) => number | null;
}

/**
 * `files` in loader order: the changed paths by the summed seconds of the
 * files that load them, ties by path, each path's loaders not given yet in
 * the order of `files`; then the files that load no changed path; then the
 * files whose closure is unknown. A file with no stored seconds counts at
 * the median of the others, or as 1 when none has any, so a path then costs
 * its loader count.
 */
export function loaderOrder(
  files: readonly TestFileRef[],
  changed: readonly RelativePath[],
  inputs: OrderInputs,
): TestFileRef[] {
  const stored = files.map(inputs.seconds);
  const fallback = median(stored.filter((s): s is number => s !== null)) ?? 1;
  // Each changed path's loaders, in the order of `files`, from one pass over each closure.
  const byPath = new Map(
    changed.map((path) => [path, { path, loaders: [] as TestFileRef[], seconds: 0 }]),
  );
  const known: TestFileRef[] = [];
  for (const [i, ref] of files.entries()) {
    const loads = inputs.loads(ref);
    if (loads === null) continue;
    known.push(ref);
    for (const path of new Set(loads)) {
      const entry = byPath.get(path);
      if (entry === undefined) continue;
      entry.loaders.push(ref);
      entry.seconds += stored[i] ?? fallback;
    }
  }
  const paths = [...byPath.values()]
    .filter((p) => p.loaders.length > 0)
    .sort((a, b) => a.seconds - b.seconds || compare(a.path, b.path));
  const given = new Set<TestFileRef>();
  const give = (ref: TestFileRef) => given.add(ref);
  for (const { loaders } of paths) loaders.forEach(give);
  known.forEach(give);
  files.forEach(give);
  return [...given];
}
