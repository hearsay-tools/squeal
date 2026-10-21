import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorktreePaths } from "../../src/core/fs/worktree-paths.js";
import { testFileFrame } from "../../src/core/status/test-frame.js";
import type {
  AbsolutePath,
  CheckError,
  CheckId,
  ProjectName,
  RelativePath,
} from "../../src/core/types/index.js";
import { parsePytestEvents } from "../../src/runners/pytest/run/events.js";
import { readBatch } from "../../src/runners/pytest/run/report.js";

/*
 * Row 011-76 (011-64 R2, gh-67), tests 2 and 3: the first frame in a
 * check's own test file, read from its first error's stored stack.
 */

const check = (testPath: string, fullName = "saves after idle"): CheckId => ({
  kind: "test",
  project: "unit" as ProjectName,
  testPath: testPath as RelativePath,
  fullName,
});

const error = (
  stack: string | null,
  location: { path: string; line: number; column: number } | null,
): CheckError => ({
  name: "AssertionError",
  message: "boom",
  stack,
  location: location === null ? null : { ...location, path: location.path as RelativePath },
  diff: null,
});

describe("testFileFrame on V8 stacks (011-76 tests 1 to 3)", () => {
  it("names the test-file frame below a helper's (issue-67's Vitest shape)", () => {
    const stack = [
      "AssertionError: expected 'idle' to be 'saved'",
      "    at assertSaved (test/harness-parity.testkit.ts:823:40)",
      "    at test/harness-autosave.test.ts:84:15",
      "    at file:///w/node_modules/@vitest/runner/dist/index.js:155:11",
    ].join("\n");
    const errors = [
      error(stack, { path: "test/harness-parity.testkit.ts", line: 823, column: 40 }),
    ];
    expect(testFileFrame(check("test/harness-autosave.test.ts"), errors)).toEqual({
      path: "test/harness-autosave.test.ts",
      line: 84,
      column: 15,
    });
  });

  it("names a node:test stack's frame", () => {
    const stack = [
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
      "    at expectReady (test/helpers/ready.ts:5:9)",
      "    at TestContext.<anonymous> (test/a.test.ts:12:3)",
      "    at Test.runInAsyncScope (node:async_hooks:211:14)",
    ].join("\n");
    const errors = [error(stack, { path: "test/helpers/ready.ts", line: 5, column: 9 })];
    expect(testFileFrame(check("test/a.test.ts"), errors)).toEqual({
      path: "test/a.test.ts",
      line: 12,
      column: 3,
    });
  });

  it("reads a path with parentheses, as a route group's", () => {
    const stack = [
      "Error: boom",
      "    at signIn (app/(auth)/sign-in.ts:7:11)",
      "    at Object.<anonymous> (app/(auth)/login.test.ts:12:3)",
      "    at app/(auth)/login.test.ts:30:1",
    ].join("\n");
    const errors = [error(stack, { path: "app/(auth)/sign-in.ts", line: 7, column: 11 })];
    expect(testFileFrame(check("app/(auth)/login.test.ts"), errors)).toEqual({
      path: "app/(auth)/login.test.ts",
      line: 12,
      column: 3,
    });
  });

  it("names none when the location is in the test file", () => {
    const stack = "Error: boom\n    at test/a.test.ts:9:5\n    at test/a.test.ts:20:3";
    const errors = [error(stack, { path: "test/a.test.ts", line: 9, column: 5 })];
    expect(testFileFrame(check("test/a.test.ts"), errors)).toBeNull();
  });

  it("names none when the stack holds no frame of the test (a timer callback)", () => {
    const stack = [
      "Error: page did not settle",
      "    at Timeout._onTimeout (packages/web/e2e/agent-browser.ts:835:67)",
      "    at listOnTimeout (node:internal/timers:588:17)",
      "    at process.processTimers (node:internal/timers:523:7)",
    ].join("\n");
    const errors = [
      error(stack, { path: "packages/web/e2e/agent-browser.ts", line: 835, column: 67 }),
    ];
    expect(testFileFrame(check("packages/web/e2e/tab-coordination.e2e.ts"), errors)).toBeNull();
  });

  it("names none with no location, no stack, no error or no test path", () => {
    const stack = "Error: boom\n    at src/x.ts:1:2\n    at test/a.test.ts:3:4";
    const helper = { path: "src/x.ts", line: 1, column: 2 };
    expect(testFileFrame(check("test/a.test.ts"), [error(stack, null)])).toBeNull();
    expect(testFileFrame(check("test/a.test.ts"), [error(null, helper)])).toBeNull();
    expect(testFileFrame(check("test/a.test.ts"), [])).toBeNull();
    const setup: CheckId = {
      kind: "setup",
      project: "unit" as ProjectName,
      testPath: "test/a.test.ts" as RelativePath,
    };
    expect(testFileFrame(setup, [error(stack, helper)])).toBeNull();
  });

  it("names none when the stack does not name the location: it never guesses", () => {
    const stack = "Error: boom\n    at src/other.ts:7:7\n    at test/a.test.ts:3:4";
    const errors = [error(stack, { path: "src/x.ts", line: 1, column: 2 })];
    expect(testFileFrame(check("test/a.test.ts"), errors)).toBeNull();
  });
});

/*
 * Test 2's pytest cases: `squeal_pytest`'s event streams of one real run per
 * traceback style (`recorded/README.md` says how they were made). The
 * project sits in `py/` below the worktree root, so long and short reports
 * name paths from pytest's cwd while the check's test path is the root's.
 */
describe("testFileFrame on recorded pytest reports (011-76 test 2)", () => {
  const ROOT = "/w/root" as AbsolutePath;
  const paths = new WorktreePaths(ROOT);
  const testFile = {
    project: "py" as ProjectName,
    path: "py/frames/test_frames.py" as RelativePath,
  };

  function errorsOf(style: string, test: string): readonly CheckError[] {
    const text = readFileSync(
      join(import.meta.dirname, "recorded", `pytest-tb-${style}.jsonl`),
      "utf8",
    );
    const events = parsePytestEvents(text.replaceAll("<root>", ROOT));
    const files = [{ testFile, real: join(ROOT, testFile.path) as AbsolutePath }];
    const read = readBatch(events, files, join(ROOT, "py") as AbsolutePath, paths);
    const result = read.files[0]?.results.find((r) => r.check.fullName === test);
    if (result === undefined) throw new Error(`no result for ${test} in ${style}`);
    return result.errors;
  }

  const of = (style: string, test: string) =>
    testFileFrame(check(testFile.path, test), errorsOf(style, test));

  it.each(["long", "short", "native"])("names the test function's line in a %s report", (style) => {
    expect(of(style, "test_helper_assert")).toEqual({ path: testFile.path, line: 6 });
    expect(of(style, "test_helper_raise")).toEqual({ path: testFile.path, line: 10 });
  });

  it.each(["long", "short", "native"])(
    "names none in a %s report when the test itself fails",
    (style) => {
      expect(of(style, "test_own_assert")).toBeNull();
    },
  );

  it("names none for --tb=line, which keeps no frames", () => {
    expect(errorsOf("line", "test_helper_assert")[0]?.location?.path).toBe("py/frames/helpers.py");
    expect(of("line", "test_helper_assert")).toBeNull();
  });
});
