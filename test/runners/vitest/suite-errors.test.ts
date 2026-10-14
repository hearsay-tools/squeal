import { describe, expect, it } from "vitest";
import { recordsForFile } from "../../../src/core/scheduler/records.js";
import { describeFailure } from "../../../src/core/state/fingerprint.js";
import type { CheckKey, Provenance } from "../../../src/core/types/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Task 001-360 (research environment-failures Q1): a hook error inside a
 * `describe` lands on the suite task, not the module, so the file was stored
 * PASS with its tests SKIP. It fails the file like a file-level hook does.
 */
describe("vitest adapter: suite-level hook errors", SLOW, () => {
  it("stores a describe-level beforeAll throw as a file-level FAIL with its message", async () => {
    // The research fixture's shape: `f-describe-beforeall.test.ts`.
    const fx = await openFixture("basic", {
      "test/describe-hook.test.ts": [
        'import { beforeAll, describe, expect, test } from "vitest";',
        'describe("group", () => {',
        "  beforeAll(() => {",
        '    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");',
        "  });",
        '  test("inside", () => expect(1).toBe(1));',
        "});",
        'test("outside", () => expect(1).toBe(1));',
        "",
      ].join("\n"),
    });
    const testFile = ref("test/describe-hook.test.ts");
    const report = await fx.adapter.run([testFile], fx.runOptions());

    expect(report.end).toBe("completed");
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["group > inside", "skip"],
      ["outside", "pass"],
    ]);
    expect(report.fileErrors.map((e) => e.testFile)).toEqual([testFile]);
    const error = report.fileErrors[0]?.errors[0];
    expect(error?.message).toBe("connect ECONNREFUSED 127.0.0.1:5432");
    expect(error?.location).toEqual({ path: "test/describe-hook.test.ts", line: 4, column: 11 });

    const records = recordsForFile({
      ref: testFile,
      key: "key" as CheckKey,
      report,
      previousChecks: [],
      provenance: { worktree: "w", revision: 1 } as unknown as Provenance,
      describe: describeFailure,
    });
    expect(records.map((r) => [r.check.kind, r.outcome])).toEqual([
      ["test", "skip"],
      ["test", "pass"],
      ["file", "fail"],
    ]);
    expect(records.at(-1)?.summary).toContain("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("keeps the innermost failing suite's error and a describe-level afterAll error", async () => {
    const fx = await openFixture("basic", {
      "test/nested-hooks.test.ts": [
        'import { afterAll, beforeAll, describe, expect, test } from "vitest";',
        'describe("outer", () => {',
        '  test("first", () => expect(1).toBe(1));',
        '  describe("inner", () => {',
        '    beforeAll(() => { throw new Error("inner setup failed"); });',
        '    test("deep", () => expect(1).toBe(1));',
        "  });",
        "});",
        'describe("teardown", () => {',
        '  afterAll(() => { throw new Error("teardown failed"); });',
        '  test("runs", () => expect(1).toBe(1));',
        "});",
        "",
      ].join("\n"),
    });
    const testFile = ref("test/nested-hooks.test.ts");
    const report = await fx.adapter.run([testFile], fx.runOptions());

    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
      ["outer > first", "pass"],
      ["outer > inner > deep", "skip"],
      ["teardown > runs", "pass"],
    ]);
    expect(report.fileErrors[0]?.errors.map((e) => e.message)).toEqual([
      "inner setup failed",
      "teardown failed",
    ]);
  });

  it("puts a file-level error ahead of the suites' errors and logs which suite failed", async () => {
    const fx = await openFixture("basic", {
      "test/both-levels.test.ts": [
        'import { afterAll, describe, expect, test } from "vitest";',
        'afterAll(() => { throw new Error("file teardown failed"); });',
        'describe("group", () => {',
        '  afterAll(() => { throw new Error("group teardown failed"); });',
        '  test("runs", () => expect(1).toBe(1));',
        "});",
        "",
      ].join("\n"),
    });
    const options = fx.runOptions();
    const report = await fx.adapter.run([ref("test/both-levels.test.ts")], options);

    expect(report.fileErrors[0]?.errors.map((e) => e.message)).toEqual([
      "file teardown failed",
      "group teardown failed",
    ]);
    expect(fx.read(".squeal-logs/vitest.log")).toContain(
      "suite-level error (group): Error: group teardown failed",
    );
  });

  // Vitest fails a `describe` with no test unless `passWithNoTests` is set, on the suite.
  it("fails a file with an empty describe, as Vitest does", async () => {
    const fx = await openFixture("basic", {
      "test/empty-describe.test.ts": [
        'import { describe, test } from "vitest";',
        'describe("empty", () => {});',
        'test("runs", () => {});',
        "",
      ].join("\n"),
    });
    const report = await fx.adapter.run([ref("test/empty-describe.test.ts")], fx.runOptions());

    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["runs", "pass"]]);
    expect(report.fileErrors[0]?.errors.map((e) => e.message)).toEqual([
      "No test found in suite empty",
    ]);
  });
});
