import { describe, expect, it } from "vitest";
import {
  errorKind,
  failureKind,
  proofExit,
  type SideEnd,
  verdictOf,
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

  it("exits 0 all proven, 1 not red or not green, 3 when one is unknown", () => {
    expect(proofExit(["proven", "proven"])).toBe(0);
    expect(proofExit(["proven", "not red"])).toBe(1);
    expect(proofExit(["not green"])).toBe(1);
    expect(proofExit(["not red", "red for another reason"])).toBe(3);
    expect(proofExit(["proven", "not comparable"])).toBe(3);
  });
});
