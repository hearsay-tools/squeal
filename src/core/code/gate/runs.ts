import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { RunEstimate } from "./estimate.js";
import type { PrepareRun } from "./prepare.js";
import type { GateEvidenceSource, GateRunReport, GateTimes } from "./report.js";
import { type ChildFiles, type Evidence, GATE_RUNNERS, type TestFileEvidence } from "./types.js";

/*
 * Spec 020 D7: the report's `runs`, one per runner that selected a file or
 * ran, from the collector's evidence and the runs' durations.
 */

const sorted = (paths: Iterable<RelativePath>) => [...new Set(paths)].sort(compare);

/** D7's `runs`: each runner that selected a file or ran, in a fixed order. */
export function runsOf(evidence: Evidence, durationsMs: GateTimes["durationsMs"]): GateRunReport[] {
  return GATE_RUNNERS.flatMap((runner) => {
    const files = evidence.testFiles.filter((f) => f.runner === runner);
    const durationMs = durationsMs[runner] ?? null;
    if (files.length === 0 && durationMs === null) return [];
    const failed = files
      .filter((f) => f.failed.length > 0)
      .map((f) => ({ path: f.path, tests: [...f.failed].sort(compare) }))
      .sort((a, b) => compare(a.path, b.path));
    const from = sourcesOf(files);
    const children = childFilesOf(files);
    const prepare = runner === "node-test" ? preparesOf(evidence) : null;
    const estimate = evidence.estimates?.find((e) => e.runner === runner);
    return [
      {
        runner,
        selected: sorted(files.map((f) => f.path)),
        completed: sorted(files.filter((f) => f.completed).map((f) => f.path)),
        notFinished: sorted(files.filter(unfinished).map((f) => f.path)),
        failed,
        ...(from === null ? {} : { from }),
        ...(children === null ? {} : { children }),
        ...(prepare === null ? {} : { prepare }),
        ...(estimate === undefined ? {} : { estimate: withoutRunner(estimate) }),
        durationMs,
      },
    ];
  });
}

const withoutRunner = ({ seconds, files, known, width }: RunEstimate) => ({
  seconds,
  files,
  known,
  width,
});

/** A file that started and did not finish; one its `prepare` kept from running is not (D15.3). */
const unfinished = (f: TestFileEvidence) => !f.completed && f.notPrepared !== true;

/** D15.3: the `prepare` runs, by entry; `null` when none. */
function preparesOf(evidence: Evidence): PrepareRun[] | null {
  const runs = evidence.prepares ?? [];
  if (runs.length === 0) return null;
  return [...runs]
    .map((run) => ({ ...run, notRun: [...run.notRun].sort(compare) }))
    .sort((a, b) => compare(a.project, b.project));
}

/** Each file's evidence source, by path; `null` when this command ran every one. */
function sourcesOf(
  files: readonly TestFileEvidence[],
): Record<RelativePath, GateEvidenceSource> | null {
  if (files.every((f) => f.from === undefined)) return null;
  const byPath = [...files].sort((a, b) => compare(a.path, b.path));
  return Object.fromEntries(byPath.map((f) => [f.path, f.from ?? "run"]));
}

/** D12.7: the sum of the files' child coverage files; `null` when none counts them. */
function childFilesOf(files: readonly TestFileEvidence[]): ChildFiles | null {
  const counted = files.flatMap((f) => (f.children === undefined ? [] : [f.children]));
  if (counted.length === 0) return null;
  return {
    read: counted.reduce((sum, c) => sum + c.read, 0),
    dropped: counted.reduce((sum, c) => sum + c.dropped, 0),
  };
}
