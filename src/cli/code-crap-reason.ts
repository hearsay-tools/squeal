import type { FileSummary, PendingReason, UnknownCause } from "../core/code/crap/index.js";
import { SQUEAL_COMMAND } from "../core/delivery/index.js";
import { plural } from "../core/text.js";
import type { CodeKnownState, CodeOutcome } from "../core/types/code.js";

/*
 * Row 015-101 (gh-129, D9): why a function's CRAP is unknown, in the few
 * words `squeal code <path>` prints and gives as `crap.reason`. A function
 * in a parse error has no complexity, so no judgement scores it (review
 * 0.1.381 B1). Else a file not judged gives its own condition, and a file
 * judged at the state's blob the function's own join, the only way a full
 * judgement makes CRAP unknown. Otherwise the cause is not known. Row
 * 015-104 (gh-155): a pending CRAP, and a function the coverage step has
 * not judged at all, read as pending with what they wait for; one not
 * judged in an unknown file reads unknown with the file's cause. They
 * explain the state and change no judgement.
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
/** Row 015-104: no condition at the file's current blob. */
const NOT_JUDGED = "the coverage step has not judged this file's current bytes yet";
const CAUSE_UNKNOWN = "cause unknown";

type Pending = Extract<FileSummary, { state: "pending" }>;

/**
 * Row 015-104: a pending file's wait, with the number of test files it
 * waits for, and for runs the command `squeal status` names for them.
 * `command` is how the text names the CLI, as status names it (review
 * 0.1.408 B2: an absolute launcher under Codex).
 */
export function pendingWords({ reason, waiting }: Pending, command = SQUEAL_COMMAND): string {
  const count = waiting > 1 ? ` (${plural(waiting, "test file")} wait)` : "";
  const them = waiting > 1 ? "them" : "it";
  const run = reason === "run" ? `; ${command} run --all runs ${them}` : "";
  return `${PENDING[reason]}${count}${run}`;
}

/** A function's CRAP as `squeal code` gives it: an unknown or pending one with its reason. */
export interface CrapShown {
  readonly outcome: CodeOutcome;
  readonly value: number | null;
  readonly reason?: string;
}

/**
 * A function's CRAP for `squeal code`, from its states and its file's
 * condition; `blob` is the file's current one. Row 015-104: with a
 * complexity and no CRAP state while `crapOn`, pending with what it waits
 * for. `null`: none to give, with CRAP off, or with no complexity counted,
 * since no judgement scores a function in a parse error.
 */
export function crapFor(
  states: { readonly crap?: CodeKnownState; readonly complexity?: CodeKnownState },
  file: FileSummary | undefined,
  blob: string | undefined,
  crapOn: boolean,
  command = SQUEAL_COMMAND,
): CrapShown | null {
  const { crap, complexity } = states;
  if (crap !== undefined) {
    const { outcome, value } = crap;
    if (outcome === "unknown") {
      return { outcome, value, reason: unknownCrapReason(file, crap, complexity, command) };
    }
    if (outcome === "pending") {
      const reason =
        complexity?.outcome === "unknown" ? PARSE : pendingCrapReason(file, blob, command);
      return { outcome, value, reason };
    }
    return { outcome, value };
  }
  if (!crapOn || (complexity?.outcome !== "pass" && complexity?.outcome !== "fail")) return null;
  // D9: an unknown source's functions are unknown, a first-seen one too.
  if (file?.state === "unknown")
    return { outcome: "unknown", value: null, reason: UNKNOWN[file.cause] };
  return { outcome: "pending", value: null, reason: pendingCrapReason(file, blob, command) };
}

/** The reason for `state`, an unknown CRAP, from the function's complexity and its file's condition. */
export function unknownCrapReason(
  file: FileSummary | undefined,
  state: CodeKnownState,
  complexity?: CodeKnownState,
  command = SQUEAL_COMMAND,
): string {
  if (complexity?.outcome === "unknown") return PARSE;
  if (file?.state === "pending") return pendingWords(file, command);
  if (file?.state === "unknown") return UNKNOWN[file.cause];
  if (file?.state === "judged" && file.blob === state.blob) return JOIN;
  return CAUSE_UNKNOWN;
}

/**
 * Row 015-104: the reason for a pending CRAP, from its file's condition at
 * `blob`, the file's current one. A file judged there with the function
 * still pending has no known cause.
 */
export function pendingCrapReason(
  file: FileSummary | undefined,
  blob: string | undefined,
  command = SQUEAL_COMMAND,
): string {
  if (file?.state === "pending") return pendingWords(file, command);
  if (file?.state === "unknown") return UNKNOWN[file.cause];
  if (file?.state === "judged" && file.blob === blob) return CAUSE_UNKNOWN;
  return NOT_JUDGED;
}
