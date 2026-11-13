import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { GateRunReport } from "./report.js";
import { RUNNER_NAMES, type TestFileEvidence } from "./types.js";

/*
 * Spec 020 D13.2 as amended by row 020-49 (#205): why a selected test file
 * a part holds was not taken from it. `partsEvidence` names each refusal;
 * the report gives it by path in `runs[].refused` (D7), beside `from`,
 * which says whether the stores then gave the file or it ran here; stderr
 * gives one bounded line per reason. Certification does not change: a
 * refused file runs, or the stores give it, as before.
 */

/**
 * Why a part did not give a selected file it holds, in the order
 * `partsEvidence` checks them: `duplicate`, more than one part holds it;
 * `unusable`, its part gives no evidence (`unusable`, `coverage.children`);
 * `environment`, its part ran its project in another environment;
 * `closure`, the runner gives no closure of it here; `input`, the part does
 * not certify an input of its closure or of what it read; `record`, it
 * passed and the part holds no record of it; `unread`, its record could not
 * read a changed path; `source`, its record holds other bytes of a source.
 */
export type PartRefusalReason =
  | "duplicate"
  | "unusable"
  | "environment"
  | "closure"
  | "input"
  | "record"
  | "unread"
  | "source";

/** One selected file a part holds and did not give, as the report gives it. */
export interface GatePartRefusal {
  /** The part's file name; with `duplicate`, the first by name. */
  readonly part: string;
  readonly reason: PartRefusalReason;
  /** `input`, `unread`, `source`: the first path, by name, that refused it. */
  readonly input?: RelativePath;
  /**
   * What the reason alone does not say: the other parts (`duplicate`), the
   * part's or environment's difference (`unusable`, `environment`), how
   * the input differs and how many do (`input`), why the part holds no
   * record (`record`). Absent when the reason says it all.
   */
  readonly detail?: string;
}

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

/**
 * Row 020-49: the stderr text, one line per runner and per-file reason,
 * with how many files it refused, how many of those ran here and how many
 * the stores gave, and up to `REFUSED_NAMES` of them, each with its input;
 * `""` when the parts refused none. `unusable` and `environment` are told
 * once per part as the parts are read, so they add no line here.
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
      const stored = files.filter(([path]) => run.from?.[path] === "store").length;
      const where = [
        ...(files.length > stored ? [`${files.length - stored} run here`] : []),
        ...(stored > 0 ? [`${stored} read from the stores`] : []),
      ].join(", ");
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
