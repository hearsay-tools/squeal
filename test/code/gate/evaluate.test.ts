import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { BasePolicy } from "../../../src/core/code/gate/policy.js";
import {
  changedSet,
  evidence,
  fn,
  type PathInput,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D5 (row 020-01): each function's state and gap, and the verdict.
 */

function judged(
  paths: readonly PathInput[],
  files: Parameters<typeof evidence>[0],
  policy: BasePolicy = POLICY,
) {
  const report = evaluate(changedSet(paths), evidence(files), policy, VERSIONS, TIMES);
  const by = Object.fromEntries(report.functions.map((f) => [f.qualifiedName, f]));
  return { report, by };
}

describe("evaluate: limits", () => {
  it("passes CC 20 and CRAP exactly 30, and a CC of 21 is a violation with no coverage", () => {
    const covered = fn("covered", [1, 5], 20);
    const never = fn("never", [1, 5], 5);
    const big = fn("big", [1, 5], 21);
    const { report, by } = judged(
      [
        { path: "src/covered.ts", functions: [covered], changed: ["covered"] },
        { path: "src/never.ts", functions: [never], changed: ["never"] },
        { path: "src/big.ts", functions: [big], changed: ["big"] },
      ],
      [
        testFile(
          "test/a.test.ts",
          ["src/covered.ts", "src/never.ts"],
          [source("src/covered.ts", [covered]), source("src/never.ts", [never], { ran: [] })],
        ),
      ],
    );
    expect(by.covered).toMatchObject({ state: "pass", gap: null, complexity: 20, crap: 20 });
    expect(by.never).toMatchObject({ state: "pass", crap: 30, coverage: { share: 0 } });
    expect(by.big).toMatchObject({
      state: "violation",
      gap: null,
      coverage: null,
      crap: null,
      loaders: { expected: [], measured: [] },
    });
    expect(report.verdict).toBe("violations");
  });
});

describe("evaluate: complete evidence", () => {
  it("is a violation over the CRAP limit, and keeps the measures of every state", () => {
    const missed = fn("missed", [1, 5], 6);
    const half = fn("half", [10, 14], 10);
    const { by } = judged(
      [{ path: "src/a.ts", functions: [missed, half], changed: ["missed", "half"] }],
      [
        testFile(
          "test/a.test.ts",
          ["src/a.ts"],
          // `half` ran lines 10 to 12 of its five: 60%, CRAP 10² × 0.4³ + 10 = 16.4.
          [source("src/a.ts", [missed, half], { ran: ["half"], covered: [10, 11, 12] })],
        ),
      ],
    );
    expect(by.missed).toMatchObject({ state: "violation", gap: null, crap: 42 });
    expect(by.missed?.coverage).toEqual({ lines: 5, covered: 0, share: 0 });
    expect(by.half).toMatchObject({ state: "pass", coverage: { lines: 5, covered: 3 } });
    expect(by.half?.crap).toBeCloseTo(16.4, 10);
    expect(by.half?.loaders).toEqual({
      expected: ["test/a.test.ts"],
      measured: ["test/a.test.ts"],
    });
  });

  it("joins over every counted function of the path, so a nested callback's lines are not its parent's", () => {
    // Only `outer` changed. Its own lines are 1, 2, 11 and 12; `inner`'s 3 to 10 ran.
    const outer = fn("outer", [1, 12], 13);
    const inner = fn("outer.<callback>", [2, 11], 1);
    const { by } = judged(
      [{ path: "src/a.ts", functions: [outer, inner], changed: ["outer"] }],
      [
        testFile(
          "test/a.test.ts",
          ["src/a.ts"],
          [source("src/a.ts", [outer, inner], { covered: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })],
        ),
      ],
    );
    // 2 of 4: 13² × 0.5³ + 13 = 34.125. Counting `inner`'s lines as its own would read 10 of 12, a pass.
    expect(by.outer).toMatchObject({ state: "violation", coverage: { lines: 4, covered: 2 } });
    expect(by.outer?.crap).toBe(34.125);
    expect(by["outer.<callback>"]).toBeUndefined();
  });
});

describe("evaluate: gaps", () => {
  const a = fn("a", [1, 5], 3);
  const path: PathInput = { path: "src/a.ts", functions: [a], changed: ["a"] };

  it("reads no-loader, never a CRAP from 0%, when no test loads the source", () => {
    const { by, report } = judged([path], [testFile("test/other.test.ts", ["src/other.ts"], [])]);
    expect(by.a).toMatchObject({
      state: "incomplete",
      gap: "no-loader",
      coverage: null,
      crap: null,
      loaders: { expected: [], measured: [] },
    });
    expect(report.verdict).toBe("incomplete");
  });

  it("reads not-finished for a loader the budget stopped, and no-record for one with no record", () => {
    const stopped = judged(
      [path],
      [testFile("test/a.test.ts", ["src/a.ts"], [], { completed: false })],
    );
    expect(stopped.by.a).toMatchObject({
      gap: "not-finished",
      loaders: { expected: ["test/a.test.ts"], measured: [] },
    });
    const none = judged([path], [testFile("test/a.test.ts", ["src/a.ts"], [], { record: null })]);
    expect(none.by.a).toMatchObject({ state: "incomplete", gap: "no-record" });
  });

  it("reads no-record for a record of other bytes or one that could not confirm them", () => {
    const stale = judged(
      [path],
      [
        testFile(
          "test/a.test.ts",
          ["src/a.ts"],
          [source("src/a.ts", [a], { blob: "e".repeat(40) })],
        ),
      ],
    );
    expect(stale.by.a).toMatchObject({ state: "incomplete", gap: "no-record" });
    const unread = judged(
      [path],
      [testFile("test/a.test.ts", ["src/a.ts"], [], { unread: ["src/a.ts"] })],
    );
    expect(unread.by.a).toMatchObject({ state: "incomplete", gap: "no-record" });
  });

  it("counts a test file whose closure is not known as a loader that may be missing", () => {
    const { by } = judged([path], [testFile("test/a.test.ts", null, [], { record: null })]);
    expect(by.a).toMatchObject({
      gap: "no-record",
      loaders: { expected: ["test/a.test.ts"], measured: [] },
    });
  });

  it("reads not-joined when no record can tell whether the function ran", () => {
    // One line, no V8 entry and no own line inside its body: the join gives `ran: null`.
    const tiny = fn("tiny", [1, 1], 1);
    const { by } = judged(
      [{ path: "src/a.ts", functions: [tiny], changed: ["tiny"] }],
      [
        testFile(
          "test/a.test.ts",
          ["src/a.ts"],
          [{ ...source("src/a.ts", [tiny]), functions: [] }],
        ),
      ],
    );
    expect(by.tiny).toMatchObject({ state: "incomplete", gap: "not-joined", crap: null });
  });

  it("reads not-counted for a function inside a parse error", () => {
    const { by } = judged(
      [{ path: "src/a.ts", functions: [a], changed: [], inErrors: ["a"] }],
      [testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [a])])],
    );
    expect(by.a).toMatchObject({ state: "incomplete", gap: "not-counted", crap: null });
  });

  it("reads test-failed when any selected test failed, and keeps the measures", () => {
    const { by, report } = judged(
      [path],
      [
        testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [a])]),
        testFile("test/b.test.ts", ["src/b.ts"], [], { failed: ["b > breaks"] }),
      ],
    );
    expect(by.a).toMatchObject({ state: "incomplete", gap: "test-failed", crap: 3 });
    expect(report.verdict).toBe("incomplete");
  });
});
