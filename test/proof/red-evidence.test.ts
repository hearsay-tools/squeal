import { describe, expect, it } from "vitest";
import {
  errorKind,
  failureKind,
  NOT_SHOWN_TO_MATTER,
  proofExit,
  redCounts,
  redEvidence,
  type SideEnd,
  THROWN_REASON,
  verdictOf,
  withControl,
} from "../../src/core/proof/verdict.js";
import type { CheckError } from "../../src/core/types/check.js";

/*
 * Row 023-22, spec 023 D5.5 as amended 2026-11-19 (the human on issue
 * #244, "A: evidence rule"): assertion evidence counts whatever the
 * error's name; an error the test body threw on purpose counts, labelled;
 * engine errors and failures in import, setup, hooks or a timeout do not;
 * `--red-error` accepts a failure by its message.
 */

const SPEC = "packages/web/e2e/automations-disabled.e2e.ts";
const HELPER = "packages/web/e2e/agent-browser.ts";

const error = (more: Partial<CheckError>): CheckError => ({
  name: "Error",
  message: "predicate never became truthy",
  stack: null,
  location: null,
  diff: null,
  ...more,
});

/** Issue #244's record: a wait helper's plain `Error`, thrown while the test body ran. */
const WAIT = error({
  message:
    "predicate never became truthy: document.body.textContent.includes('Automations are off')",
  stack: `Error: predicate never became truthy\n    at AgentBrowser.waitForFunction (${HELPER}:551:13)\n    at ${SPEC}:35:11`,
  location: { path: HELPER, line: 551, column: 13 },
  stage: "body",
});

const fail = (...errors: CheckError[]): SideEnd => ({
  end: "fail",
  failures: [{ test: "automations disabled", errors }],
});
const pass: SideEnd = { end: "pass" };

describe("red evidence (row 023-22, D5.5 as amended for #244)", () => {
  it("proves issue #244's wait error, labelled as a thrown error with its text, exit 0", () => {
    expect(errorKind(WAIT)).toBe("thrown");
    expect(redCounts(fail(WAIT))).toBe(true);
    const verdict = verdictOf(fail(WAIT), pass);
    expect(verdict.verdict).toBe("proven");
    expect(verdict.reason).toBe(
      `${THROWN_REASON}: Error: predicate never became truthy: document.body.textContent.includes('Automations are off')`,
    );
    expect(redEvidence(fail(WAIT))).toBe("thrown");
    expect(proofExit([verdict.verdict])).toBe(0);
  });

  it.each([
    [
      "a Playwright-style expect error (matcher result, no AssertionError name)",
      { assertionEvidence: true as const },
    ],
    ["an error with a diff", { diff: "- Expected\n+ Received" }],
    ["node:assert's code", { code: "ERR_ASSERTION" }],
  ])("counts %s as an assertion, wherever it was thrown", (_label, more) => {
    for (const stage of [undefined, "body"] as const) {
      const e = error({ ...more, ...(stage === undefined ? {} : { stage }) });
      expect(errorKind(e)).toBe("assertion");
      expect(verdictOf(fail(e), pass)).toEqual({ verdict: "proven", reason: null });
      expect(redEvidence(fail(e))).toBe("assertion");
    }
  });

  it.each([
    ["a missing export (TypeError)", { name: "TypeError", message: "(0 , b) is not a function" }],
    ["ReferenceError", { name: "ReferenceError" }],
    ["SyntaxError", { name: "SyntaxError" }],
    ["pytest's NameError", { name: "NameError" }],
    ["pytest's AttributeError", { name: "AttributeError" }],
    ["pytest's ImportError", { name: "ImportError" }],
    ["pytest's ModuleNotFoundError", { name: "ModuleNotFoundError" }],
    ["pytest's TypeError", { name: "TypeError" }],
    ["a dynamic import's ERR_MODULE_NOT_FOUND", { code: "ERR_MODULE_NOT_FOUND" }],
    ["a refused connection's ECONNREFUSED", { code: "ECONNREFUSED" }],
  ])("keeps %s in the body red for another reason", (_label, more) => {
    const e = error({ ...more, stage: "body" });
    expect(errorKind(e)).toBe("error");
    expect(redCounts(fail(e))).toBe(false);
    expect(verdictOf(fail(e), null).verdict).toBe("red for another reason");
    expect(proofExit(["red for another reason"])).toBe(3);
  });

  it.each([
    ["a hook (beforeEach, a pytest fixture)", { stage: "hook" as const }, "hook"],
    ["a runner timeout", { stage: "timeout" as const }, "timeout"],
    ["a timeout with its load", { stage: "body" as const, loadAverage: 3 }, "timeout"],
    ["the file's load", { stage: "body" as const, phase: "load" as const }, "import"],
    ["the project's setup", { phase: "setup" as const }, "setup"],
    ["the file's teardown", { phase: "after-tests" as const }, "hook"],
    ["a cancellation or uncaught error", { stage: "other" as const }, "error"],
    ["a record with no stage (stored before 023-22)", {}, "error"],
  ])("keeps an Error from %s red for another reason", (_label, more, kind) => {
    const e = error(more);
    expect(errorKind(e)).toBe(kind);
    expect(verdictOf(fail(e), null).verdict).toBe("red for another reason");
  });

  it("keeps an assertion in a hook red for another reason", () => {
    expect(errorKind(error({ name: "AssertionError", stage: "hook" }))).toBe("hook");
  });

  it("counts a deliberate custom class and pytest's own exceptions as thrown", () => {
    for (const name of ["WaitTimeoutError", "Exception", "ValueError", "Failed", "app.errors.Gone"])
      expect(errorKind(error({ name, stage: "body" }))).toBe("thrown");
    expect(errorKind(error({ name: "builtins.TypeError", stage: "body" }))).toBe("error");
  });

  it("labels a test thrown when its errors mix assertions and thrown errors, else by the other kind", () => {
    const assertion = error({ name: "AssertionError", stage: "body" });
    expect(failureKind({ test: "t", errors: [assertion, WAIT] })).toBe("thrown");
    expect(failureKind({ test: "t", errors: [assertion, assertion] })).toBe("assertion");
    expect(failureKind({ test: "t", errors: [WAIT, error({ stage: "hook" })] })).toBe("hook");
  });

  it("accepts a failure by --red-error's text, but never where the test did not start", () => {
    const hook = error({ message: "Hook timed out: page.waitForSelector", stage: "hook" });
    expect(errorKind(hook, ["waitForSelector"])).toBe("thrown");
    expect(errorKind(hook, ["other text"])).toBe("hook");
    const typeError = error({ name: "TypeError", message: "x is not a function", stage: "body" });
    expect(errorKind(typeError, ["not a function"])).toBe("thrown");
    expect(errorKind(error({ stage: "timeout", message: "Test timed out" }), ["timed out"])).toBe(
      "thrown",
    );
    expect(errorKind(error({ phase: "load", message: "Cannot find module" }), ["Cannot"])).toBe(
      "import",
    );
    expect(errorKind(error({ phase: "setup", message: "global setup" }), ["global"])).toBe("setup");
    const verdict = verdictOf(fail(hook), pass, ["waitForSelector"]);
    expect(verdict).toEqual({
      verdict: "proven",
      reason: `${THROWN_REASON}: Error: Hook timed out: page.waitForSelector`,
    });
    expect(redEvidence(fail(hook), ["waitForSelector"])).toBe("thrown");
    expect(redEvidence(fail(hook))).toBeNull();
  });

  it("keeps the thrown label in front of the control run's reason (P9)", () => {
    const proven = verdictOf(fail(WAIT), pass);
    expect(withControl(proven, fail(WAIT))).toEqual({
      verdict: "proven",
      reason: `${proven.reason}; ${NOT_SHOWN_TO_MATTER}`,
    });
  });
});
