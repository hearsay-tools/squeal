import type { RelativePath } from "../../types/common.js";
import type { TestFileEvidence } from "./types.js";

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
