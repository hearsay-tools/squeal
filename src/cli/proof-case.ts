import { type Conditions, hasConditions } from "../core/proof/conditions.js";
import { defaultCase, type ProofCase } from "../core/proof/sides.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 023 D5 (rows 023-08, 023-21): the proof's default case, and why an
 * unchanged named test's runs keep no record of their reads.
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
    cases.set(ref.path, defaultCase(ref.path, loads(ref), changed, named, source));
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
 * Row 023-21 (fifth look 2): why the sides' reads are not recorded: a
 * forced side (a condition, `--repeat`) keeps nothing, so it merges no
 * reads; `null` when they are.
 */
export function unrecordedWhy(common: {
  readonly conditions: Conditions;
  readonly repeat: number;
}): string | null {
  if (hasConditions(common.conditions))
    return "a side under a condition records no reads, so no changed file may be left unnamed";
  if (common.repeat > 1)
    return "a repeated side records no reads, so no changed file may be left unnamed";
  return null;
}
