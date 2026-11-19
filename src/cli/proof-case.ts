import { defaultCase, type ProofCase } from "../core/proof/sides.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 023 D5 (rows 023-08, 023-21): the proof's default case.
 */

/**
 * D5's default case: one for every named file, from the diff `base..HEAD`
 * and each file's closure now; a usage problem when the files need
 * different ones, or one needs neither. Row 023-21: `named` holds the
 * `--with` paths too, so a helper given there counts as test-side.
 */
export function caseOf(
  base: string,
  refs: readonly TestFileRef[],
  loads: (ref: TestFileRef) => readonly RelativePath[],
  changed: ReadonlySet<RelativePath>,
  named: ReadonlySet<RelativePath>,
  source: ReadonlySet<RelativePath>,
): ProofCase | { usage: string } {
  const cases = new Map<RelativePath, ProofCase | null>();
  for (const ref of refs)
    cases.set(
      ref.path,
      defaultCase(ref.path, loads(ref), changed, named, source) ?? flagCase(changed, source, named),
    );
  const none = [...cases].filter(([, kind]) => kind === null).map(([path]) => path);
  if (none.length > 0)
    return {
      usage: `${base.slice(0, 9)}..HEAD changes nothing ${none.join(", ")} loads; give --case source or --case test`,
    };
  const kinds = new Set(cases.values());
  if (kinds.size > 1) {
    const each = [...cases].map(([path, kind]) => `${path}: ${kind}`).join(", ");
    return {
      usage: `the named files need different cases (${each}); give --case or prove them in separate calls`,
    };
  }
  return [...kinds][0] as ProofCase;
}

/**
 * Row 023-21 (D5.2, "A: every changed file"): an unchanged named test whose
 * keyed closure holds no changed file takes its case from the flags that
 * named the changed files: `source` when one is a `--source` path, `test`
 * when they are all `--with` paths; `null` when nothing changed.
 */
function flagCase(
  changed: ReadonlySet<RelativePath>,
  source: ReadonlySet<RelativePath>,
  named: ReadonlySet<RelativePath>,
): ProofCase | null {
  const paths = [...changed];
  if (paths.some((path) => source.has(path))) return "source";
  return paths.some((path) => named.has(path)) ? "test" : null;
}
