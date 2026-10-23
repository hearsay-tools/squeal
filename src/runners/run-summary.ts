import type { RunReport } from "../core/types/index.js";

/*
 * A run log's report (001 D8 as amended 2026-10-23, row 011-164): how the
 * run ended, its cancel cause, its duration and each file's, the files it
 * completed, file errors and the projects it started. Each check's result and
 * the observed paths live only in the store; nothing reads them back here.
 */

/** The part of a `RunReport` a run log keeps. */
export type RunSummary = Pick<
  RunReport,
  | "end"
  | "failure"
  | "durationMs"
  | "fileDurations"
  | "completedFiles"
  | "fileErrors"
  | "startedProjects"
>;

export function runSummary(report: RunReport): RunSummary {
  const { end, failure, durationMs, fileDurations, completedFiles, fileErrors, startedProjects } =
    report;
  return {
    end,
    failure,
    durationMs,
    ...(fileDurations === undefined ? {} : { fileDurations }),
    completedFiles,
    fileErrors,
    ...(startedProjects === undefined ? {} : { startedProjects }),
  };
}

/** A run log's text: `fields` and the summary of `report` as `report`, one line of JSON. */
export function runLogJson(fields: Readonly<Record<string, unknown>>, report: RunReport): string {
  return `${JSON.stringify({ ...fields, report: runSummary(report) })}\n`;
}
