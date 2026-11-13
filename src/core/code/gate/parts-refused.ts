import type { FileRefusal, ReuseReason } from "../../ci/reuse.js";
import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { GateRunReport } from "./report.js";
import { RUNNER_NAMES, type TestFileEvidence } from "./types.js";

/*
 * Spec 020 D13.2 as amended by row 020-49 (#205): why a selected test file
 * a part holds was not taken from it. `FileReuse` (`ci/reuse.ts`) makes
 * each refusal, and `partsEvidence` names it; the report gives it by path
 * in `runs[].refused` (D7), beside `from`, which says whether the stores
 * then gave the file or it ran here; stderr gives one bounded line per
 * reason. Certification does not change: a
 * refused file runs, or the stores give it, as before.
 */

/**
 * Why a part did not give a selected file it holds: the reasons of D13.2,
 * in the order `FileReuse` checks them (`ci/reuse.ts`, row 020-52).
 */
export type PartRefusalReason = ReuseReason;

/** One selected file a part holds and did not give, as the report gives it (`FileRefusal`). */
export type GatePartRefusal = FileRefusal;

/** `partsEvidence`'s refusal of one selected file. */
export interface PartRefusal extends GatePartRefusal {
  readonly runner: TestFileEvidence["runner"];
  readonly path: RelativePath;
}

/** Each reason a line tells, in the order the lines go; the part-wide ones are told per part. */
const TOLD: readonly (readonly [PartRefusalReason, string])[] = [
  ["duplicate", "more than one part holds it"],
  ["closure", "the runner gives no closure of it here"],
  ["input", "its part does not certify an input as it is here"],
  ["record", "it passed and its part holds no coverage record of it"],
  ["unread", "its record could not read a changed path"],
  ["source", "its record holds other bytes of a source"],
];

/** The file names a line gives at most; the rest are counted. */
const REFUSED_NAMES = 3;

/** What became of a refused file, as the final run report has it, in the order a line tells them. */
const OUTCOMES = [
  ["ran", "ran here"],
  ["unfinished", "started here and did not finish"],
  ["not-run", "did not run"],
  ["stored", "read from the stores"],
] as const;

type Outcome = (typeof OUTCOMES)[number][0];

/**
 * Review 0.1.465 B1: `path`'s outcome in `run`. The stores gave it; it
 * completed here; it never started (`notStarted`), the gate stopped early
 * before it (`overBudget`) or it went to no run; or it started and did not
 * finish.
 */
function outcomeOf(run: GateRunReport, path: RelativePath): Outcome {
  if (run.from?.[path] === "store") return "stored";
  if (run.completed.includes(path)) return "ran";
  if (run.notStarted?.includes(path) || run.overBudget?.includes(path)) return "not-run";
  return run.notFinished.includes(path) ? "unfinished" : "not-run";
}

/**
 * Row 020-49: the stderr text, one line per runner and per-file reason,
 * with how many files it refused and, from the final run report, how many
 * of those ran here, started here and did not finish, did not run, and
 * were read from the stores (review 0.1.465 B1); and up to
 * `REFUSED_NAMES` of them, each with its input. `""` when the parts
 * refused none. `unusable` and `environment` are told once per part as
 * the parts are read, so they add no line here.
 */
export function refusedText(runs: readonly GateRunReport[]): string {
  return refusedLines(runs).join("");
}

function refusedLines(runs: readonly GateRunReport[]): string[] {
  return runs.flatMap((run) => {
    const refused = Object.entries(run.refused ?? {}).sort(([a], [b]) => compare(a, b));
    return TOLD.flatMap(([reason, text]) => {
      const files = refused.filter(([, r]) => r.reason === reason);
      if (files.length === 0) return [];
      const outcomes = files.map(([path]) => outcomeOf(run, path));
      const where = OUTCOMES.flatMap(([outcome, said]) => {
        const count = outcomes.filter((o) => o === outcome).length;
        return count === 0 ? [] : [`${count} ${said}`];
      }).join(", ");
      const names = files
        .slice(0, REFUSED_NAMES)
        .map(([path, r]) => (r.input === undefined ? path : `${path}: ${r.input}`));
      const more = files.length > REFUSED_NAMES ? `, and ${files.length - REFUSED_NAMES} more` : "";
      const count = files.length === 1 ? "1 test file" : `${files.length} test files`;
      const runner = RUNNER_NAMES[run.runner];
      return [
        `squeal code: ${runner}: ${count} not taken from the parts, ${where}: ${text} (${names.join(", ")}${more})\n`,
      ];
    });
  });
}
