import type { CodeCoverageStatus } from "../../types/code-delivery.js";
import type { Policy, WorktreeId } from "../../types/index.js";
import type { CodeStore } from "../store/types.js";
import type { PendingReason, UnknownCause } from "./loaders.js";
import { readSummary } from "./summary.js";

/*
 * Spec 015 D9 (row 015-12): status's coverage part, read from the code
 * store with no daemon. Which files wait, for a test file's imports, a run
 * or a record, so status says when only `squeal run --all` judges them
 * (`baseline.onStart: lookup-only`).
 */

/** `CodeStatus.coverage`, or `undefined` before the daemon's coverage step judged here. */
export function coverageStatusOf(
  store: CodeStore,
  worktreeId: WorktreeId,
  policy: Pick<Policy, "crap" | "vitest">,
): CodeCoverageStatus | undefined {
  const summary = readSummary(store.meta, worktreeId);
  if (summary === null) return undefined;
  const fails = (measure: "crap" | "uncovered") =>
    store.states.list(worktreeId, { measure, outcome: "fail" }).length;
  const files = Object.values(summary.files);
  const waiting = (reason: PendingReason) =>
    files.filter((f) => f.state === "pending" && f.reason === reason).length;
  const causes: Partial<Record<UnknownCause, number>> = {};
  for (const f of files) if (f.state === "unknown") causes[f.cause] = (causes[f.cause] ?? 0) + 1;
  const notRead = [...policy.vitest.exclude, ...policy.vitest.excludeProjects];
  return {
    v: 1,
    threshold: policy.crap.threshold,
    crap: fails("crap"),
    uncovered: fails("uncovered"),
    files: files.length,
    waitingForRuns: waiting("run"),
    waitingForRecords: waiting("record"),
    ...(waiting("imports") === 0
      ? {}
      : {
          waitingForImports: { files: waiting("imports"), testFiles: summary.withoutImports ?? 0 },
        }),
    unknown: causes,
    ...(notRead.length === 0 ? {} : { notRead }),
  };
}
