import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type { CheckError, RunReport, TestFileRef } from "../../../../src/core/types/index.js";

/*
 * What a run's report stores (011 C14, rows 011-41 and 011-48), as the
 * adapter kinds compare it: the files it completed and withheld, each
 * result's identity, outcome and fingerprint, the files that failed to load
 * with theirs, as `recordsForFile` stores them (review of cand/0.1.232, B1).
 */

export const sortedRefs = (refs: readonly TestFileRef[] = []) =>
  refs.map((ref) => `${ref.project}:${ref.path}`).sort();

/** A file-level error's fingerprint as `recordsForFile` stores it: at its first error's location. */
const loadFingerprint = (errors: readonly CheckError[]) =>
  describeFailure(errors, errors[0]?.location ?? null).fingerprint;

const byText =
  <T>(text: (v: T) => string) =>
  (a: T, b: T) =>
    text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0;

/** What a run's report stores, as a decision reads it: a fingerprint is compared through `sameFingerprint`. */
export function storedOf(report: RunReport) {
  return {
    completed: sortedRefs(report.completedFiles),
    withheld: sortedRefs(report.withheld),
    results: report.results
      .map((r) => ({
        check: JSON.stringify(r.check),
        outcome: r.outcome,
        fingerprint:
          r.outcome === "fail" ? describeFailure(r.errors, r.location).fingerprint : null,
      }))
      .sort(byText((r) => r.check)),
    loadErrors: report.fileErrors
      .map((e) => ({
        file: `${e.testFile.project}:${e.testFile.path}`,
        fingerprint: loadFingerprint(e.errors),
      }))
      .sort(byText((e) => e.file)),
  };
}
