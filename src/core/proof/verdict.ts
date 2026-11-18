import type { FailedTest } from "../code/gate/types.js";
import type { CheckError } from "../types/check.js";

/*
 * Spec 023 D5.5, D5.6 (row 023-08): a red proof's verdict per test file,
 * and the command's exit code. A failure is told apart by the runner's own
 * failure records, as `squeal why` reads them: an error's class name and
 * code, the phase a file-level error happened in, and the load a timeout
 * recorded. No message text is read.
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

/** What kind of failure an error is: an assertion, or what else stopped the test. */
export type FailureKind = "assertion" | "import" | "setup" | "hook" | "timeout" | "error";

/** An assertion library's own error: `expect`'s (chai) and `node:assert`'s. */
const ASSERTION_NAMES = new Set(["AssertionError"]);

/** The kind of one recorded error. */
export function errorKind(error: CheckError): FailureKind {
  if (error.phase === "load") return "import";
  if (error.phase === "setup") return "setup";
  if (error.phase === "after-tests") return "hook";
  // The runner records the load average with a test's or hook's timeout, and with nothing else.
  if (error.loadAverage !== undefined) return "timeout";
  if (ASSERTION_NAMES.has(error.name) || error.code === "ERR_ASSERTION") return "assertion";
  return "error";
}

/**
 * The kind of one failed test: `assertion` only when every error it
 * recorded is one; else the first other kind. A failure with no recorded
 * error is `error`: nothing shows it was an assertion.
 */
export function failureKind(failure: FailedTest): FailureKind {
  const kinds = failure.errors.map(errorKind);
  return kinds.find((kind) => kind !== "assertion") ?? (kinds.length > 0 ? "assertion" : "error");
}

const KIND_TEXT: Readonly<Record<Exclude<FailureKind, "assertion">, string>> = {
  import: "the file failed to load (an import, a syntax error or a top-level throw)",
  setup: "the project's setup failed",
  hook: "a hook or the file's teardown failed",
  timeout: "a test or hook timed out",
  error: "a test threw an error that is not an assertion",
};

/** D5.5: the verdict of one file from its red and green ends; green `null` when it was not read. */
export function verdictOf(red: SideEnd, green: SideEnd | null): FileVerdict {
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
  const other = red.failures.map(failureKind).find((kind) => kind !== "assertion");
  if (red.failures.length === 0 || other !== undefined)
    return { verdict: "red for another reason", reason: KIND_TEXT[other ?? "error"] };
  if (green?.end === "unknown" && green.reason === NOT_RUN_BUDGET)
    return { verdict: "not comparable", reason: "budget" };
  if (green === null || green.end === "unknown") {
    // Row 023-20 (P7): never "not read" alone.
    const why = green === null ? "not run" : green.reason;
    return { verdict: "not comparable", reason: `green side: ${why}` };
  }
  if (green.end === "pass") return { verdict: "proven", reason: null };
  const how =
    green.end === "fail" ? "failed" : green.end === "timeout" ? "timed out" : "not prepared";
  return { verdict: "not green", reason: `the green side ${how}` };
}

/** Whether the red side failed on assertions alone, so the green side decides. */
export function redOnAssertion(red: SideEnd): boolean {
  return (
    red.end === "fail" &&
    red.failures.length > 0 &&
    red.failures.every((f) => failureKind(f) === "assertion")
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
  return "red did not fail on an assertion: nothing to prove";
}

/**
 * Row 023-20 (lessons P9): what the red side's control run, once without
 * the conditions, shows: the red side failed only under them, or failed
 * without them too; `not known` when the control run has no pass or
 * assertion failure (not run, timed out, failed for another reason).
 */
export type ControlReading = "red only under the conditions" | "red without them too" | "not known";

export function controlReading(control: SideEnd): ControlReading {
  if (control.end === "pass") return "red only under the conditions";
  return redOnAssertion(control) ? "red without them too" : "not known";
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
export function withControl(verdict: FileVerdict, control: SideEnd | null): FileVerdict {
  if (control === null || verdict.verdict !== "proven") return verdict;
  return controlReading(control) === "red without them too"
    ? { verdict: "proven", reason: NOT_SHOWN_TO_MATTER }
    : verdict;
}
