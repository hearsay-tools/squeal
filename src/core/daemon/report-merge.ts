import { compare } from "../fs/compare.js";
import type { RunEnd, RunnerAdapter, RunReport } from "../types/runner.js";

/*
 * The report merge (GLOSSARY.md; row 011-330): how the reports of a run's
 * parts become one run report, by one rule per `RunReport` field. `merge` in
 * `composite-runner.ts` applies them, for the composite and the remote lane.
 * A rule's presence is part of it: it answers `undefined` to leave an
 * optional field absent.
 */

/** One part of a run and its report; `adapter.name` prefixes the part's failure. */
export interface Part {
  readonly adapter: Pick<RunnerAdapter, "name">;
  readonly report: RunReport;
}

/** One rule per field: a `RunReport` field with no rule fails the typecheck. */
export type MergeRules = {
  readonly [K in keyof RunReport]-?: (parts: readonly Part[]) => RunReport[K];
};

const SEVERITY: Readonly<Record<RunEnd, number>> = { completed: 0, "timed-out": 1, crashed: 2 };

/** Every part's list in the parts' order, present always. */
function listed<T>(field: (report: RunReport) => readonly T[]) {
  return (parts: readonly Part[]): readonly T[] => parts.flatMap(({ report }) => field(report));
}

/** Every part's list in the parts' order, present when a part has one, even empty. */
function listedWhenAny<T>(field: (report: RunReport) => readonly T[] | undefined) {
  return (parts: readonly Part[]): readonly T[] | undefined =>
    parts.some(({ report }) => field(report) !== undefined)
      ? parts.flatMap(({ report }) => field(report) ?? [])
      : undefined;
}

/** Every part's list in the parts' order, present only when not empty. */
function listedWhenFound<T>(field: (report: RunReport) => readonly T[] | undefined) {
  return (parts: readonly Part[]): readonly T[] | undefined => {
    const all = parts.flatMap(({ report }) => field(report) ?? []);
    return all.length > 0 ? all : undefined;
  };
}

/**
 * The rules, in the order of the merged report's keys. Files stay trusted
 * per part, because a crashed part lists no completed files and a
 * completed one does not depend on it.
 */
export const MERGE_RULES: MergeRules = {
  // The worst part's, so the run is recorded as it went wrong.
  end: (parts) =>
    parts.reduce<RunEnd>(
      (worst, { report }) => (SEVERITY[report.end] > SEVERITY[worst] ? report.end : worst),
      "completed",
    ),
  durationMs: (parts) => parts.reduce((sum, { report }) => sum + report.durationMs, 0),
  completedFiles: listed((report) => report.completedFiles),
  results: listed((report) => report.results),
  fileErrors: listed((report) => report.fileErrors),
  // Each failing part's, named by its adapter; `null` when none failed.
  failure: (parts) => {
    const failures = parts.flatMap(({ adapter, report }) =>
      report.failure === null ? [] : [`${adapter.name}: ${report.failure}`],
    );
    return failures.length === 0 ? null : failures.join("; ");
  },
  fileDurations: listedWhenAny((report) => report.fileDurations),
  observed: listedWhenAny((report) => report.observed),
  reads: listedWhenAny((report) => report.reads),
  environmentObserved: listedWhenFound((report) => report.environmentObserved),
  skippedFiles: listedWhenFound((report) => report.skippedFiles),
  withheld: listedWhenFound((report) => report.withheld),
  // Row 011-145: each part's focused counts, in the parts' order as `completedFiles`.
  focused: listedWhenFound((report) => report.focused),
  // Task 001-382: the first part's. One adapter runs Vitest, so at most one
  // composite part fails to start; the remote lane merges no part after a
  // setup failure (review 0.1.457 B3).
  startupFailure: (parts) =>
    parts.find(({ report }) => report.startupFailure !== undefined)?.report.startupFailure,
  // Each project once, sorted.
  startedProjects: (parts) => {
    const started = [...new Set(parts.flatMap(({ report }) => report.startedProjects ?? []))];
    return started.length === 0 ? undefined : started.sort(compare);
  },
};
