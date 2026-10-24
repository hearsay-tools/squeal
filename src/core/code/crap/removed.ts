import type { CodeCheckId, CodeTransition } from "../../types/code.js";
import type { EpochMs, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeStore } from "../store/types.js";
import { COVERAGE_MEASURES } from "./step.js";
import { deleteSummary, readSummary, writeEvidence } from "./summary.js";

/*
 * Spec 015 D5 for D9's measures, beside the complexity pass: a function
 * removed while its `crap` or `uncovered` state is `fail` is resolved, "no
 * longer in the code"; and the states go when coverage goes off.
 */

/** The `removed` transitions of `checks`' failing coverage states, before the pass removes them. */
export function removedFailures(
  store: Pick<CodeStore, "states">,
  worktreeId: WorktreeId,
  checks: readonly CodeCheckId[],
  revision: RevisionNumber,
  at: EpochMs,
): CodeTransition[] {
  if (checks.length === 0) return [];
  const gone = new Set(checks.map((c) => JSON.stringify([c.path, c.qualifiedName, c.occurrence])));
  const paths = [...new Set(checks.map((c) => c.path))];
  return store.states
    .list(worktreeId, { paths, outcome: "fail" })
    .filter(
      (s) =>
        s.measure !== "complexity" &&
        gone.has(JSON.stringify([s.check.path, s.check.qualifiedName, s.check.occurrence])),
    )
    .map((s) => ({
      worktreeId,
      check: s.check,
      measure: s.measure,
      kind: "removed" as const,
      from: s.outcome,
      to: null,
      fromValue: s.value,
      toValue: null,
      threshold: s.threshold,
      revision,
      at,
    }));
}

/**
 * `coverage.enabled` is off: the worktree's D9 states, evidence and
 * summary go, so a later switch on seeds them again. Nothing when it has
 * none; whether it wrote.
 */
export function clearCoverage(store: CodeStore, worktreeId: WorktreeId): boolean {
  const summary = readSummary(store.meta, worktreeId);
  if (summary === null) return false;
  store.transaction(() => {
    for (const measure of COVERAGE_MEASURES) store.states.removeMeasure(worktreeId, measure);
    for (const path of Object.keys(summary.files))
      writeEvidence(store.meta, worktreeId, path, null);
    deleteSummary(store.meta, worktreeId);
  });
  return true;
}
