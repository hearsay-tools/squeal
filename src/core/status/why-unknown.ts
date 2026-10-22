import { basename, dirname } from "node:path";
import { testFileOf } from "../state/index.js";
import type {
  AbsolutePath,
  CheckId,
  KnownState,
  Store,
  WhyReport,
  WhyRunLog,
  WhyUnknownRun,
  WorktreeId,
} from "../types/index.js";

/*
 * Row 011-108 (gh-74; 011 C6 and C7 as amended): `why` names the run behind
 * an UNKNOWN known state, its worktree and revision and its log, also when
 * every stored result of the check is a pass. The run is recorded beside the
 * state (`FailureRepo.unknownRuns`), never as a keyed result. A missing log
 * names one reason.
 */

/**
 * The run behind `knownState` when it is UNKNOWN: the record of its test
 * file that fits it, by its revision and its reason. `logOf` reads a run's
 * log as `runLog` does. `undefined` for any other state.
 */
export function unknownRunOf(
  store: Store,
  worktreeId: WorktreeId,
  check: CheckId,
  knownState: KnownState | null,
  logOf: (run: { runId: string; worktreeId: WorktreeId }, logDir: AbsolutePath) => WhyRunLog,
): WhyUnknownRun | undefined {
  if (knownState?.outcome !== "unknown") return undefined;
  const file = testFileOf(check);
  const record = store.failures
    .unknownRuns(worktreeId)
    .find(
      (r) =>
        r.testFile.project === file.project &&
        r.testFile.path === file.path &&
        r.revision === knownState.observedAt &&
        r.reason === knownState.summary,
    );
  const error = knownState.summary;
  if (record === undefined) {
    return {
      runId: null,
      worktreeId,
      revision: knownState.observedAt,
      error,
      missing: "older-daemon",
    };
  }
  const { runId, revision } = record;
  if (runId === null) return { runId, worktreeId, revision, error, missing: "never-written" };
  // Prune keeps the run while the UNKNOWN stands; a release before 011-108 drops it at the cutoff.
  const run = store.runs.get(runId);
  if (run === null) return { runId, worktreeId, revision, error, missing: "pruned" };
  const log = logOf({ runId, worktreeId: run.worktreeId }, run.logDir);
  const at = { runId, worktreeId: run.worktreeId, revision: run.revision, error };
  return log.state === "pruned" ? { ...at, missing: "never-written" } : { ...at, log };
}

/** The `Run log:` lines of an UNKNOWN state, in place of the gap `runLog` names. */
export function unknownRunLines(why: WhyReport, unknown: WhyUnknownRun): string[] {
  const where =
    unknown.worktreeId === why.worktreeId
      ? `${why.worktreeRoot} (this worktree)`
      : (why.worktreeRoots[unknown.worktreeId] ?? `removed worktree ${unknown.worktreeId}`);
  const run = `run ${unknown.runId ?? "unknown"} in ${where}${unknown.revision === null ? "" : ` at revision ${unknown.revision}`}`;
  switch (unknown.missing) {
    case "older-daemon":
      return [
        "Run log: none; a Squeal daemon older than this release recorded this UNKNOWN and kept no record of its run",
      ];
    case "pruned":
      return [
        `Run log: none; ${run} ended this check UNKNOWN, and its run record and log were pruned`,
      ];
    case "never-written":
      return unknown.runId === null
        ? [
            "Run log: none; no run ended this check UNKNOWN (its runner, install or environment failed before one ran), so none was written",
          ]
        : [`Run log: none; ${run} ended this check UNKNOWN and never wrote its log`];
    default:
      return logLines(unknown.log, run);
  }
}

function logLines(log: WhyRunLog | undefined, run: string): string[] {
  if (log === undefined) return [];
  const capital = `${run.charAt(0).toUpperCase()}${run.slice(1)}`;
  const lines =
    log.state === "not-vitest"
      ? [
          `Run log: none, ${run} wrote no ${basename(log.path)}`,
          `  ${capital} ended this check UNKNOWN; its runner's output is under ${dirname(log.path)}`,
        ]
      : [
          `Run log: ${log.path}`,
          `  ${capital} ended this check UNKNOWN. ${log.state === "node-test" ? `Its stderr log: ${log.stderrPath ?? "not recorded"}.` : "The log covers that whole run, every test file in it, not only this check."}`,
        ];
  if (log.console === null) return lines;
  const { lines: kept, total } = log.console;
  if (total === 0) return [...lines, "", "Console of this check's test file in the log: none"];
  return [
    ...lines,
    "",
    `Console of this check's test file in the log (${kept.length} of ${total} lines):`,
    ...kept.map((l) => `  ${l}`),
  ];
}
