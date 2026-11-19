import { describe, expect, it } from "vitest";
import type { SerializedError, TestCase } from "vitest/node";
import { WorktreePaths } from "../../src/core/fs/worktree-paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { toCheckError as nodeTestError } from "../../src/runners/node-test/run/errors.js";
import {
  testStage,
  toCheckError as vitestError,
  withStage,
} from "../../src/runners/vitest/results.js";

/*
 * Row 023-22 (spec 023 D5.5 as amended for #244): the runners' own records
 * of where in a test an error happened and of assertion evidence. The
 * shapes are the ones Vitest 5.0.3 and Node 26's `node:test` gave for a
 * body throw, a failing `beforeEach`, a timeout and a Playwright-style
 * matcher error (probed 2026-11-19, notes `tasks/023-22-notes.md`).
 */

const paths = new WorktreePaths("/w" as AbsolutePath);

/** A Vitest test case as far as `testStage` reads it: its internal task's hook states. */
const vitestCase = (hooks: Record<string, string> | undefined, result = true) =>
  ({
    task: result ? { result: { state: "fail", ...(hooks ? { hooks } : {}) } } : {},
  }) as unknown as TestCase;

describe("Vitest records (row 023-22)", () => {
  it("tells the body from a hook that threw by the hooks' states", () => {
    expect(testStage(vitestCase(undefined))).toBe("body");
    expect(testStage(vitestCase({ beforeEach: "pass", afterEach: "pass" }))).toBe("body");
    // Vitest sets `pass` only after every hook of a kind returned: a throw leaves `run`.
    expect(testStage(vitestCase({ beforeEach: "run" }))).toBe("hook");
    expect(testStage(vitestCase({ beforeEach: "pass", afterEach: "run" }))).toBe("hook");
    expect(testStage(vitestCase(undefined, false))).toBeNull();
  });

  it("marks a timeout by Vitest's message, else the test's stage", () => {
    const base = vitestError({ name: "Error", message: "boom" } as SerializedError, paths);
    expect(withStage(base, "body")).toMatchObject({ stage: "body" });
    expect(withStage(base, null)).not.toHaveProperty("stage");
    const timedOut = vitestError(
      { name: "Error", message: "Test timed out in 50ms.\nIf this is..." } as SerializedError,
      paths,
    );
    expect(withStage(timedOut, "body")).toMatchObject({ stage: "timeout" });
  });

  it("records assertion evidence: a matcher result, or the expected and actual values", () => {
    const matcher = {
      name: "Error",
      message: "expect(locator).toHaveText",
      matcherResult: { pass: false },
    };
    expect(vitestError(matcher as SerializedError, paths)).toMatchObject({
      assertionEvidence: true,
    });
    const values = { name: "Error", message: "m", expected: "a", actual: "b" };
    expect(vitestError(values as SerializedError, paths)).toMatchObject({
      assertionEvidence: true,
    });
    const plain = vitestError({ name: "Error", message: "wait failed" } as SerializedError, paths);
    expect(plain).not.toHaveProperty("assertionEvidence");
  });
});

describe("node:test records (row 023-22)", () => {
  const failure = (failureType: string, cause: unknown) => ({
    name: "Error",
    message: "test failed",
    code: "ERR_TEST_FAILURE",
    failureType,
    cause,
  });

  it.each([
    ["testCodeFailure", "body"],
    ["hookFailed", "hook"],
    ["testTimeoutFailure", "timeout"],
    ["cancelledByParent", "other"],
    ["uncaughtException", "other"],
  ])("reads failureType %s as stage %s", (type, stage) => {
    const cause = { name: "Error", message: "wait failed", stack: null };
    expect(nodeTestError(failure(type, cause), paths)).toMatchObject({ stage });
  });

  it("gives a timeout's text cause its stage too", () => {
    const error = nodeTestError(failure("testTimeoutFailure", "test timed out after 30ms"), paths);
    expect(error).toMatchObject({ stage: "timeout", message: "test timed out after 30ms" });
  });

  it("keeps a thrown value's code, but not an assertion's, and records expected and actual", () => {
    const missing = { name: "Error", message: "Cannot find module", code: "ERR_MODULE_NOT_FOUND" };
    expect(nodeTestError(failure("testCodeFailure", missing), paths)).toMatchObject({
      code: "ERR_MODULE_NOT_FOUND",
    });
    const assertion = {
      name: "AssertionError",
      message: "Expected values to be strictly equal",
      code: "ERR_ASSERTION",
      actual: 1,
      expected: 2,
      generatedMessage: true,
    };
    const read = nodeTestError(failure("testCodeFailure", assertion), paths);
    expect(read).not.toHaveProperty("code");
    expect(read).toMatchObject({ assertionEvidence: true, stage: "body" });
  });

  it("leaves the stage out when the runner gives no failure type", () => {
    const error = nodeTestError({ name: "Error", message: "m", cause: { message: "x" } }, paths);
    expect(error).not.toHaveProperty("stage");
  });
});
