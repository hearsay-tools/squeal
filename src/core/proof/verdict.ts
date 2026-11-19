import type { FailedTest } from "../code/gate/types.js";
import { cap } from "../text.js";
import type { CheckError } from "../types/check.js";

/*
 * Spec 023 D5.5, D5.6 (row 023-08): a red proof's verdict per test file,
 * and the command's exit code. A failure is told apart by the runner's own
 * failure records, as `squeal why` reads them: an error's class name and
 * code, the phase a file-level error happened in, the load a timeout
 * recorded, and (row 023-22, D5.5 as amended 2026-11-19) where in its test
 * the error happened and its assertion evidence. No message text is read,
 * except for the texts `--red-error` names.
 */

/** A side's reason when the budget left a run of it not started (row 023-11). */
export const NOT_RUN_BUDGET = "not run (budget)";

/** How one side of one file ended. */
export type SideEnd =
  | { readonly end: "pass" }
  | { readonly end: "fail"; readonly failures: readonly FailedTest[] }
  /** It started and the budget stopped it. */
  | { readonly end: "timeout" }
  /** It did not run: its node:test `prepare` failed. */
  | { readonly end: "prepare" }
  /** No outcome: not comparable, not determined, not run for want of budget. */
  | { readonly end: "unknown"; readonly reason: string };

export type Verdict =
  | "proven"
  | "not red"
  | "red for another reason"
  | "not green"
  | "not comparable";

export interface FileVerdict {
  readonly verdict: Verdict;
  /** Why, when the verdict is not `proven` or `not red`. */
  readonly reason: string | null;
}

/**
 * What kind of failure an error is: an assertion, a deliberate throw in the
 * test body (row 023-22), or what else stopped the test.
 */
export type FailureKind =
  | "assertion"
  | "thrown"
  | "import"
  | "setup"
  | "hook"
  | "timeout"
  | "error";

/** The kinds a red side may fail on for the green side to decide (D5.5 as amended 2026-11-19). */
const RED_KINDS: ReadonlySet<FailureKind> = new Set(["assertion", "thrown"]);

/** An assertion library's own error: `expect`'s (chai) and `node:assert`'s. */
const ASSERTION_NAMES = new Set(["AssertionError"]);

/**
 * Row 023-22: the engine's programming errors, which no test throws on
 * purpose: JavaScript's and Python's (pytest), with their subclasses.
 */
const ENGINE_ERRORS = new Set([
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "EvalError",
  "URIError",
  "NameError",
  "UnboundLocalError",
  "AttributeError",
  "ImportError",
  "ModuleNotFoundError",
  "IndentationError",
  "TabError",
]);

/** A Node error code (`ERR_MODULE_NOT_FOUND`) or a system one (`ECONNREFUSED`): no deliberate throw. */
const SYSTEM_CODE = /^(?:ERR_[A-Z0-9_]+|E[A-Z0-9]+)$/;

/** Whether an error carries assertion evidence: its class, its code, expected and actual values, a diff. */
function isAssertion(error: CheckError): boolean {
  return (
    ASSERTION_NAMES.has(error.name) ||
    error.code === "ERR_ASSERTION" ||
    error.assertionEvidence === true ||
    error.diff !== null
  );
}

/** An `Error` or a custom subclass the test body threw: not an engine error, no system code. */
function isDeliberate(error: CheckError): boolean {
  const name = error.name.slice(error.name.lastIndexOf(".") + 1);
  return !ENGINE_ERRORS.has(name) && !(error.code !== undefined && SYSTEM_CODE.test(error.code));
}

/** The kind of one recorded error by the runner's records alone. */
function recordedKind(error: CheckError): FailureKind {
  if (error.phase === "load") return "import";
  if (error.phase === "setup") return "setup";
  if (error.phase === "after-tests") return "hook";
  // The runner records the load average with a test's or hook's timeout, and with nothing else.
  if (error.loadAverage !== undefined || error.stage === "timeout") return "timeout";
  if (error.stage === "hook") return "hook";
  if (isAssertion(error)) return "assertion";
  return error.stage === "body" && isDeliberate(error) ? "thrown" : "error";
}

/**
 * The kind of one recorded error. `redErrors` are `--red-error`'s texts: an
 * error whose message holds one counts as `thrown` whatever else it is,
 * except where its test did not start (an import, the project's setup).
 */
export function errorKind(error: CheckError, redErrors: readonly string[] = []): FailureKind {
  const kind = recordedKind(error);
  if (RED_KINDS.has(kind) || kind === "import" || kind === "setup") return kind;
  return redErrors.some((text) => error.message.includes(text)) ? "thrown" : kind;
}

/**
 * The kind of one failed test: `assertion` only when every error it
 * recorded is one; `thrown` when every error is an assertion or a thrown
 * error and one is thrown; else the first other kind. A failure with no
 * recorded error is `error`: nothing shows it was an assertion.
 */
export function failureKind(failure: FailedTest, redErrors: readonly string[] = []): FailureKind {
  const kinds = failure.errors.map((error) => errorKind(error, redErrors));
  const other = kinds.find((kind) => !RED_KINDS.has(kind));
  if (other !== undefined) return other;
  if (kinds.includes("thrown")) return "thrown";
  return kinds.length > 0 ? "assertion" : "error";
}

const KIND_TEXT: Readonly<Record<Exclude<FailureKind, "assertion" | "thrown">, string>> = {
  import: "the file failed to load (an import, a syntax error or a top-level throw)",
  setup: "the project's setup failed",
  hook: "a hook or the file's teardown failed",
  timeout: "a test or hook timed out",
  error: "a test threw an engine error, or an error outside its body",
};

/** Row 023-22: the reason a `proven` verdict carries when its red side failed on a thrown error. */
export const THROWN_REASON = "red on a thrown error, not an assertion";

/** Characters of the thrown error's text the verdict's reason keeps. */
const THROWN_TEXT_CHARS = 200;

/** `red on a thrown error, not an assertion: <name>: <first line of its message>`. */
function thrownReason(failures: readonly FailedTest[], redErrors: readonly string[]): string {
  const error = failures
    .flatMap((failure) => failure.errors)
    .find((e) => errorKind(e, redErrors) === "thrown");
  const line = error?.message.split(/\r?\n/)[0]?.trim() ?? "";
  return error === undefined
    ? THROWN_REASON
    : `${THROWN_REASON}: ${cap(`${error.name}: ${line}`, THROWN_TEXT_CHARS)}`;
}

/** Row 023-22: what a red side that counts failed on: `assertion`, else `thrown`; `null` when it does not count. */
export type RedEvidence = "assertion" | "thrown";

export function redEvidence(red: SideEnd, redErrors: readonly string[] = []): RedEvidence | null {
  if (!redCounts(red, redErrors) || red.end !== "fail") return null;
  return red.failures.some((f) => failureKind(f, redErrors) === "thrown") ? "thrown" : "assertion";
}

/** D5.5: the verdict of one file from its red and green ends; green `null` when it was not read. */
export function verdictOf(
  red: SideEnd,
  green: SideEnd | null,
  redErrors: readonly string[] = [],
): FileVerdict {
  // Row 023-11: a run the budget left not started, on either side, reads `not comparable (budget)`.
  if (red.end === "unknown")
    return {
      verdict: "not comparable",
      reason: red.reason === NOT_RUN_BUDGET ? "budget" : red.reason,
    };
  if (red.end === "pass") return { verdict: "not red", reason: null };
  if (red.end === "timeout")
    return { verdict: "red for another reason", reason: "the budget stopped the red side" };
  if (red.end === "prepare")
    return { verdict: "red for another reason", reason: "the red side's prepare failed" };
  const other = red.failures
    .map((failure) => failureKind(failure, redErrors))
    .find((kind) => !RED_KINDS.has(kind));
  if (red.failures.length === 0 || other !== undefined)
    return {
      verdict: "red for another reason",
      reason: KIND_TEXT[(other ?? "error") as keyof typeof KIND_TEXT],
    };
  if (green?.end === "unknown" && green.reason === NOT_RUN_BUDGET)
    return { verdict: "not comparable", reason: "budget" };
  if (green === null || green.end === "unknown") {
    // Row 023-20 (P7): never "not read" alone.
    const why = green === null ? "not run" : green.reason;
    return { verdict: "not comparable", reason: `green side: ${why}` };
  }
  if (green.end === "pass")
    return {
      verdict: "proven",
      reason:
        redEvidence(red, redErrors) === "thrown" ? thrownReason(red.failures, redErrors) : null,
    };
  const how =
    green.end === "fail" ? "failed" : green.end === "timeout" ? "timed out" : "not prepared";
  return { verdict: "not green", reason: `the green side ${how}` };
}

/**
 * Whether the red side failed on red evidence alone (assertions, and
 * errors the test body threw or `--red-error` accepts), so the green side
 * decides.
 */
export function redCounts(red: SideEnd, redErrors: readonly string[] = []): boolean {
  return (
    red.end === "fail" &&
    red.failures.length > 0 &&
    red.failures.every((f) => RED_KINDS.has(failureKind(f, redErrors)))
  );
}

/**
 * D5.6: 0 when every file is `proven`; 3 when one is not comparable or red
 * for another reason (an unknown answer outweighs a known one, as D1's 3
 * does); else 1, a file `not red` or `not green`.
 */
export function proofExit(verdicts: readonly Verdict[]): 0 | 1 | 3 {
  if (verdicts.some((v) => v === "not comparable" || v === "red for another reason")) return 3;
  return verdicts.every((v) => v === "proven") ? 0 : 1;
}

/**
 * Row 023-20 (lessons P7): why the green side did not run, from the red
 * side's end; the report never says "not read" alone, which an agent read
 * as a pass. The same words say why the control run (P9) did not run.
 */
export function notRunWhy(red: SideEnd): string {
  if (red.end === "pass") return "red passed: nothing to prove";
  if (red.end === "unknown")
    return red.reason === NOT_RUN_BUDGET
      ? "red not run (budget): nothing to compare"
      : "red has no result: nothing to compare";
  return "red failed for another reason: nothing to prove";
}

/**
 * Row 023-20 (lessons P9): what the red side's control run, once without
 * the conditions, shows: the red side failed only under them, or failed
 * without them too; `not known` when the control run has no pass or
 * assertion failure (not run, timed out, failed for another reason).
 */
export type ControlReading = "red only under the conditions" | "red without them too" | "not known";

export function controlReading(
  control: SideEnd,
  redErrors: readonly string[] = [],
): ControlReading {
  if (control.end === "pass") return "red only under the conditions";
  return redCounts(control, redErrors) ? "red without them too" : "not known";
}

/** P9: the reason a `proven` verdict carries when the control run failed too. */
export const NOT_SHOWN_TO_MATTER =
  "red without the conditions too: the conditions are not shown to matter";

/**
 * P9: the file's verdict with its control run: a `proven` file whose red
 * side failed without the conditions too stays `proven` (red failed and
 * green passed, under the conditions) and says the conditions are not
 * shown to matter. Any other verdict, or no control run, is unchanged.
 */
export function withControl(
  verdict: FileVerdict,
  control: SideEnd | null,
  redErrors: readonly string[] = [],
): FileVerdict {
  if (control === null || verdict.verdict !== "proven") return verdict;
  if (controlReading(control, redErrors) !== "red without them too") return verdict;
  // Row 023-22: a thrown error's label stays in front.
  const reason =
    verdict.reason === null ? NOT_SHOWN_TO_MATTER : `${verdict.reason}; ${NOT_SHOWN_TO_MATTER}`;
  return { verdict: "proven", reason };
}
