import { createInputMatcher } from "../../keys/glob.js";
import type { CodeFile } from "../../types/code.js";
import type {
  EpochMs,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { CodeStore } from "../store/types.js";
import { COVERAGE_MEASURES } from "./seed.js";
import {
  type CoverageMeasure,
  type CoverageSummary,
  writeCoverageChange,
  writeEvidence,
  writeSummary,
} from "./summary.js";

/*
 * Spec 015 D1 (row 015-64): which of D9's checks the policy keeps, and the
 * files `coverage.exclude` leaves out. A check switched off, or a file
 * newly excluded, loses its states with no transition, and the change is
 * kept for the delivery's one summary line. A check switched on, or a file
 * no longer excluded, is seeded, so its first judgement is quiet.
 */

/** What the coverage step judges, from the policy. */
export interface CoverageChecks {
  /** `crap` with `crap.enabled`, `uncovered` with `coverage.untested`, in that order. */
  readonly measures: readonly CoverageMeasure[];
  /** `coverage.exclude`. */
  readonly exclude: readonly string[];
  /** Whether `coverage.exclude` leaves `path` out. */
  readonly excluded: (path: RelativePath) => boolean;
}

export function coverageChecks(policy: Pick<Policy, "coverage" | "crap">): CoverageChecks {
  const on: Record<CoverageMeasure, boolean> = {
    crap: policy.crap.enabled,
    uncovered: policy.coverage.untested,
  };
  return {
    measures: COVERAGE_MEASURES.filter((m) => on[m]),
    exclude: policy.coverage.exclude,
    excluded: createInputMatcher(policy.coverage.exclude),
  };
}

/** Both checks and every file, as before row 015-64. */
export const ALL_CHECKS: CoverageChecks = {
  measures: COVERAGE_MEASURES,
  exclude: [],
  excluded: () => false,
};

/** `CoverageSummary.checks` for `measures`: absent for both, as an older Squeal wrote it. */
export function checksField(measures: readonly CoverageMeasure[]): {
  checks?: readonly CoverageMeasure[];
} {
  return measures.length === COVERAGE_MEASURES.length ? {} : { checks: measures };
}

/** Whether two `CoverageChecks` judge alike; a pass that sees a change steps again. */
export function sameChecks(a: CoverageChecks, b: CoverageChecks): boolean {
  return JSON.stringify([a.measures, a.exclude]) === JSON.stringify([b.measures, b.exclude]);
}

/** What `applyChecks` found against the summary. */
export interface AppliedChecks {
  /** The summary with the checks switched off and the files left out taken away. */
  readonly summary: CoverageSummary;
  /** A check switched on, or a file no longer excluded: the step seeds it quietly. */
  readonly reseed: boolean;
}

/**
 * The policy's checks against those `summary` was judged with: a check
 * switched off loses every state of its measure, and a file now excluded
 * its D9 states and evidence. The change is recorded when states went. A
 * summary that names the checks kept is written at once, so a later step
 * removes nothing again; `coverage.exclude` and a check switched on are
 * written by the step that judges after the seed.
 */
export function applyChecks(
  store: CodeStore,
  worktreeId: WorktreeId,
  checks: CoverageChecks,
  summary: CoverageSummary,
  at: { readonly revision: RevisionNumber; readonly now: EpochMs },
): AppliedChecks {
  const judged = summary.checks ?? COVERAGE_MEASURES;
  const off = judged.filter((m) => !checks.measures.includes(m));
  const on = checks.measures.filter((m) => !judged.includes(m));
  const was = summary.exclude ?? [];
  if (JSON.stringify(was) === JSON.stringify(checks.exclude)) {
    if (off.length === 0) return { summary, reseed: on.length > 0 };
    return {
      summary: removeChecks(store, worktreeId, summary, off, [], at),
      reseed: on.length > 0,
    };
  }
  const files = store.files.list(worktreeId);
  const left = files.filter((f) => checks.excluded(f.path));
  const wasExcluded = createInputMatcher(was);
  const back = files.some((f) => wasExcluded(f.path) && !checks.excluded(f.path));
  return {
    summary: removeChecks(store, worktreeId, summary, off, left, at),
    reseed: on.length > 0 || back,
  };
}

/**
 * Removes the states of the checks `off` and the D9 states and evidence of
 * the files `left`, records the change when any went, and writes the
 * summary without them. With no check left, every file goes.
 */
function removeChecks(
  store: CodeStore,
  worktreeId: WorktreeId,
  summary: CoverageSummary,
  off: readonly CoverageMeasure[],
  left: readonly CodeFile[],
  at: { readonly revision: RevisionNumber; readonly now: EpochMs },
): CoverageSummary {
  const judged = (summary.checks ?? COVERAGE_MEASURES).filter((m) => !off.includes(m));
  const paths = left.map((f) => f.path);
  return store.transaction(() => {
    for (const measure of off) store.states.removeMeasure(worktreeId, measure);
    const had =
      paths.length === 0 || judged.length === 0
        ? []
        : [
            ...new Set(
              store.states
                .list(worktreeId, { paths })
                .filter((s) => s.measure !== "complexity")
                .map((s) => s.check.path),
            ),
          ];
    for (const measure of judged) store.states.removeMeasure(worktreeId, measure, had);
    const gone = new Set(judged.length === 0 ? Object.keys(summary.files) : paths);
    for (const path of gone) writeEvidence(store.meta, worktreeId, path, null);
    if (off.length > 0 || had.length > 0) {
      writeCoverageChange(store.meta, worktreeId, {
        revision: at.revision,
        at: at.now,
        off,
        excluded: had.length,
      });
    }
    const next = without(summary, gone, judged);
    if (JSON.stringify(next) !== JSON.stringify(summary))
      writeSummary(store.meta, worktreeId, next);
    return next;
  });
}

/** `summary` judging `checks`, without the files `gone`. */
function without(
  summary: CoverageSummary,
  gone: ReadonlySet<string>,
  checks: readonly CoverageMeasure[],
): CoverageSummary {
  const keep = <T>(entries: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(entries).filter(([path]) => !gone.has(path)));
  const { quiet, brought, checks: _checks, ...rest } = summary;
  const quietKept = (quiet ?? []).filter((path) => !gone.has(path));
  const broughtKept = keep(brought ?? {});
  return {
    ...rest,
    files: keep(summary.files),
    ...checksField(checks),
    ...(quietKept.length === 0 ? {} : { quiet: quietKept }),
    ...(Object.keys(broughtKept).length === 0 ? {} : { brought: broughtKept }),
  };
}
