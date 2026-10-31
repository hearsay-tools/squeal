import type { FileSummary, PendingReason, UnknownCause } from "../core/code/crap/index.js";
import type { CodeKnownState } from "../core/types/code.js";

/*
 * Row 015-101 (gh-129, D9): why a function's CRAP is unknown, in the few
 * words `squeal code <path>` prints and gives as `crap.reason`. A function
 * in a parse error has no complexity, so no judgement scores it (review
 * 0.1.381 B1). Else a file not judged gives its own condition, and a file
 * judged at the state's blob the function's own join, the only way a full
 * judgement makes CRAP unknown. Otherwise the cause is not known. It
 * explains the state and changes no judgement.
 */

const PENDING: Readonly<Record<PendingReason, string>> = {
  imports: "waits for a test file's imports",
  run: "waits for a test file to run",
  record: "waits for a coverage record",
};

const UNKNOWN: Readonly<Record<UnknownCause, string>> = {
  "no-record": "a test file that loads this file has no coverage record",
  skipped: "a test file that loads this file skipped a test",
  unkeyed: "Squeal cannot key a test file that loads this file",
  unread: "a coverage record cannot confirm this file's bytes",
};

/** Review 0.1.297 B4: none ran the function, and a record cannot tell whether it ran. */
const JOIN = "the coverage records cannot tell whether it ran";
/** D3: `judgeFiles` skips a function whose complexity is unknown. */
const PARSE = "it is in a parse error, so its complexity is not judged";

/** A function's CRAP for `squeal code`; an unknown one with its reason. */
export const crapOf = (
  crap: CodeKnownState,
  file: FileSummary | undefined,
  complexity: CodeKnownState | undefined,
) => ({
  outcome: crap.outcome,
  value: crap.value,
  ...(crap.outcome === "unknown" ? { reason: unknownCrapReason(file, crap, complexity) } : {}),
});

/** The reason for `state`, an unknown CRAP, from the function's complexity and its file's condition. */
export function unknownCrapReason(
  file: FileSummary | undefined,
  state: CodeKnownState,
  complexity?: CodeKnownState,
): string {
  if (complexity?.outcome === "unknown") return PARSE;
  if (file?.state === "pending") return PENDING[file.reason];
  if (file?.state === "unknown") return UNKNOWN[file.cause];
  if (file?.state === "judged" && file.blob === state.blob) return JOIN;
  return "cause unknown";
}
