import type { StoredEvidence } from "./collect.js";
import type { Picked } from "./prerun.js";
import type { LeftOutFailure } from "./scope.js";

/*
 * Spec 026 D5.1 (row 026-08): a left-out test file the local stores hold a
 * current failure of, at its head key. It does not run here, so its
 * functions stay `incomplete (left-out)`; the report names the failure so
 * it is not hidden behind that state.
 */

/**
 * The left-out files of `picked` with a current stored failure, asked of
 * `lookup` once per runner with one; none without `lookup`. A lookup that
 * rejects costs only this list.
 */
export async function leftOutFailures(
  picked: readonly Picked[],
  lookup: StoredEvidence | undefined,
): Promise<LeftOutFailure[]> {
  if (lookup === undefined) return [];
  const failures: LeftOutFailure[] = [];
  for (const { kind, leftOut } of picked) {
    if (leftOut.length === 0) continue;
    const groups = new Map(leftOut.map(({ ref, group }) => [ref, group]));
    const known = await lookup(
      kind,
      leftOut.map((l) => l.ref),
    ).catch(() => new Map());
    for (const [ref, evidence] of known) {
      if (evidence.failed.length === 0) continue;
      const group = groups.get(ref) ?? "tests";
      failures.push({ runner: kind, path: ref.path, group, tests: [...evidence.failed].sort() });
    }
  }
  return failures;
}
