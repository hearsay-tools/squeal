import type { FailedTest } from "../code/gate/types.js";
import type { CheckError } from "../types/check.js";

/*
 * Spec 023 D5.5 as amended 2026-11-19 (rows 023-08, 023-22): what kind of
 * failure one recorded error is, from the runner's own records alone: its
 * class name and code, the phase a file-level error happened in, the load
 * a timeout recorded, where in its test it happened (`stage`) and its
 * assertion evidence. No message text is read, except the texts
 * `--red-error` names. Review wave-14 B2: an error with no stage is
 * `unstaged`, never inferred from its name, diff or stack.
 */

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
  | "unstaged"
  | "error";

/** The kinds a red side may fail on for the green side to decide (D5.5 as amended 2026-11-19). */
export const RED_KINDS: ReadonlySet<FailureKind> = new Set(["assertion", "thrown"]);

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
export function recordedKind(error: CheckError): FailureKind {
  if (error.phase === "load") return "import";
  if (error.phase === "setup") return "setup";
  if (error.phase === "after-tests") return "hook";
  // The runner records the load average with a test's or hook's timeout, and with nothing else.
  if (error.loadAverage !== undefined || error.stage === "timeout") return "timeout";
  // Review wave-14 B2: without its stage nothing shows the body ran; never inferred from the rest.
  if (error.stage === undefined) return "unstaged";
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
  if (RED_KINDS.has(kind) || kind === "import" || kind === "setup" || kind === "unstaged")
    return kind;
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
