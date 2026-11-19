import { describe, expect, it } from "vitest";
import {
  controlReading,
  errorKind,
  failureKind,
  NOT_RUN_BUDGET,
  NOT_SHOWN_TO_MATTER,
  notRunWhy,
  proofExit,
  type SideEnd,
  verdictOf,
  withControl,
} from "../../src/core/proof/verdict.js";
import type { CheckError } from "../../src/core/types/check.js";

/*
 * Row 023-08, spec 023 D5.5 and D5.6: verdicts from the runner's own
 * failure records: an error's class name, code, phase and the load a
 * timeout records; never its message.
 */

const error = (more: Partial<CheckError>): CheckError => ({
  name: "Error",
  message: "expected 1 to be 2",
  stack: null,
  location: null,
  diff: null,
  ...more,
});
const assertion = error({ name: "AssertionError" });
const fail = (...errors: CheckError[]): SideEnd => ({
  end: "fail",
  failures: [{ test: "t", errors }],
});
const pass: SideEnd = { end: "pass" };

describe("proof verdicts (row 023-08, D5.5, D5.6)", () => {
  it.each([
    [assertion, "assertion"],
    [error({ code: "ERR_ASSERTION" }), "assertion"],
    [error({ name: "AssertionError", phase: "load" }), "import"],
    [error({ phase: "setup" }), "setup"],
    [error({ phase: "after-tests" }), "hook"],
    [error({ message: "Test timed out in 5000ms.", loadAverage: 3.2 }), "timeout"],
    [error({ name: "TypeError", message: "AssertionError: looks like one" }), "error"],
  ])("tells %j as %s", (e, kind) => {
    expect(errorKind(e)).toBe(kind);
  });

  it("counts a failed test as an assertion only when every error is one", () => {
    expect(failureKind({ test: "t", errors: [assertion, assertion] })).toBe("assertion");
    expect(failureKind({ test: "t", errors: [assertion, error({ name: "TypeError" })] })).toBe(
      "error",
    );
    expect(failureKind({ test: "t", errors: [] })).toBe("error");
  });

  it("gives each verdict", () => {
    expect(verdictOf(fail(assertion), pass)).toEqual({ verdict: "proven", reason: null });
    expect(verdictOf(pass, null)).toEqual({ verdict: "not red", reason: null });
    expect(verdictOf(fail(error({ name: "TypeError" })), null).verdict).toBe(
      "red for another reason",
    );
    expect(verdictOf({ end: "timeout" }, null).verdict).toBe("red for another reason");
    expect(verdictOf({ end: "prepare" }, null).verdict).toBe("red for another reason");
    expect(verdictOf(fail(assertion), fail(assertion))).toMatchObject({ verdict: "not green" });
    expect(verdictOf({ end: "unknown", reason: "imports src/b.ts, absent at abc" }, null)).toEqual({
      verdict: "not comparable",
      reason: "imports src/b.ts, absent at abc",
    });
    expect(verdictOf(fail(assertion), { end: "unknown", reason: "no checkout" })).toMatchObject({
      verdict: "not comparable",
    });
  });

  it("reads not comparable (budget) when the budget left a run of either side not started (row 023-11)", () => {
    const budget: SideEnd = { end: "unknown", reason: NOT_RUN_BUDGET };
    const expected = { verdict: "not comparable", reason: "budget" };
    expect(verdictOf(budget, null)).toEqual(expected);
    expect(verdictOf(fail(assertion), budget)).toEqual(expected);
  });

  it("exits 0 all proven, 1 not red or not green, 3 when one is unknown", () => {
    expect(proofExit(["proven", "proven"])).toBe(0);
    expect(proofExit(["proven", "not red"])).toBe(1);
    expect(proofExit(["not green"])).toBe(1);
    expect(proofExit(["not red", "red for another reason"])).toBe(3);
    expect(proofExit(["proven", "not comparable"])).toBe(3);
  });

  it("says why a side did not run, never 'not read' (row 023-20, lessons P7)", () => {
    expect(notRunWhy(pass)).toBe("red passed: nothing to prove");
    expect(notRunWhy(fail(error({ name: "TypeError" })))).toBe(
      "red failed for another reason: nothing to prove",
    );
    expect(notRunWhy({ end: "timeout" })).toBe("red failed for another reason: nothing to prove");
    expect(notRunWhy({ end: "unknown", reason: NOT_RUN_BUDGET })).toBe(
      "red not run (budget): nothing to compare",
    );
    expect(notRunWhy({ end: "unknown", reason: "imports src/b.ts, absent at abc" })).toBe(
      "red has no result: nothing to compare",
    );
    expect(verdictOf(fail(assertion), null)).toEqual({
      verdict: "not comparable",
      reason: "green side: not run",
    });
  });

  it("reads the control run without the conditions (row 023-20, lessons P9)", () => {
    expect(controlReading(pass)).toBe("red only under the conditions");
    expect(controlReading(fail(assertion))).toBe("red without them too");
    expect(controlReading(fail(error({ name: "TypeError" })))).toBe("not known");
    expect(controlReading({ end: "unknown", reason: NOT_RUN_BUDGET })).toBe("not known");
    const proven = { verdict: "proven", reason: null } as const;
    expect(withControl(proven, fail(assertion))).toEqual({
      verdict: "proven",
      reason: NOT_SHOWN_TO_MATTER,
    });
    expect(withControl(proven, pass)).toEqual(proven);
    expect(withControl(proven, null)).toEqual(proven);
    const notGreen = { verdict: "not green", reason: "the green side failed" } as const;
    expect(withControl(notGreen, fail(assertion))).toEqual(notGreen);
  });
});
