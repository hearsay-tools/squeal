import { describe, expect, it } from "vitest";
import {
  type ExceptionEntry,
  QUALITY_POLICY_VERSION,
  type TestFileEvidence,
} from "../../../src/core/code/gate/types.js";
import { fn, judged, type PathInput, source, testFile } from "./evaluate-fixture.js";

/*
 * Row 020-53 (#210): a function with the gap `test-failed` names the failed
 * tests behind it, where their evidence came from, and whether each file is
 * one of its loaders. D5.5 is unchanged: one selected failure still blocks
 * every function, so states, verdicts and the policy version stay as they are.
 */

/** #210's shape: a changed node:test callback its own file covers whole. */
const callback = fn("<test>", [1, 5], 1);
const changedTest: PathInput = {
  path: "test/a.test.mjs",
  functions: [callback],
  changed: ["<test>"],
};
const ownFile = testFile(
  "test/a.test.mjs",
  ["test/a.test.mjs"],
  [source("test/a.test.mjs", [callback])],
  {
    runner: "node-test",
  },
);
/** An unrelated base test that fails; it loads only built-ins. */
const unrelated = testFile("test/b.test.mjs", ["test/b.test.mjs"], [], {
  runner: "node-test",
  failed: ["unrelated base test"],
});

const from = (file: TestFileEvidence, at: "store" | "parts"): TestFileEvidence => ({
  ...file,
  from: at,
});

describe("evaluate: the failed tests behind a test-failed gap (row 020-53)", () => {
  it("names an unrelated failure as outside the loaders of a passing, fully covered callback (#210)", () => {
    const { by, report } = judged([changedTest], [ownFile, unrelated]);
    expect(by["<test>"]).toMatchObject({
      state: "incomplete",
      gap: "test-failed",
      coverage: { lines: 5, covered: 5, share: 1 },
      crap: 1,
      loaders: { expected: ["test/a.test.mjs"], measured: ["test/a.test.mjs"] },
      failedTests: [
        { path: "test/b.test.mjs", tests: ["unrelated base test"], from: "run", loader: false },
      ],
    });
    expect(report.verdict).toBe("incomplete");
    expect(report.counts).toMatchObject({ incomplete: 1, pass: 0 });
    expect(report.versions.qualityPolicy).toBe(QUALITY_POLICY_VERSION);
    expect(QUALITY_POLICY_VERSION).toBe(4);
  });

  it("names a failure in one of its own loaders as its own, beside one outside, by path", () => {
    const a = fn("a", [1, 5], 3);
    const own = testFile("test/z.test.ts", ["src/a.ts"], [source("src/a.ts", [a])], {
      failed: ["z > second", "z > first"],
    });
    const outside = testFile("test/b.test.ts", ["src/b.ts"], [], { failed: ["b > breaks"] });
    const { by } = judged([{ path: "src/a.ts", functions: [a], changed: ["a"] }], [own, outside]);
    expect(by.a).toMatchObject({ state: "incomplete", gap: "test-failed" });
    expect(by.a?.failedTests).toEqual([
      { path: "test/b.test.ts", tests: ["b > breaks"], from: "run", loader: false },
      { path: "test/z.test.ts", tests: ["z > first", "z > second"], from: "run", loader: true },
    ]);
  });

  it("names the stores and the parts as the origin of a reused failure", () => {
    const stored = from(unrelated, "store");
    const parted = from({ ...unrelated, path: "test/c.test.mjs", failed: ["part test"] }, "parts");
    const { by } = judged([changedTest], [from(ownFile, "store"), stored, parted]);
    expect(by["<test>"]?.failedTests).toEqual([
      { path: "test/b.test.mjs", tests: ["unrelated base test"], from: "store", loader: false },
      { path: "test/c.test.mjs", tests: ["part test"], from: "parts", loader: false },
    ]);
  });

  it("adds nothing when no selected test failed, or to a function with another gap or state", () => {
    const clean = judged([changedTest], [ownFile]);
    expect(clean.by["<test>"]).toMatchObject({ state: "pass", gap: null });
    expect(clean.by["<test>"]).not.toHaveProperty("failedTests");

    const loose = fn("loose", [10, 14], 2);
    const big = fn("big", [20, 24], 21);
    const { by } = judged(
      [
        { ...changedTest, functions: [callback, big], changed: ["<test>", "big"] },
        { path: "src/loose.ts", functions: [loose], changed: ["loose"] },
      ],
      [ownFile, unrelated],
    );
    expect(by.loose).toMatchObject({ state: "incomplete", gap: "no-loader" });
    expect(by.loose).not.toHaveProperty("failedTests");
    expect(by.big).toMatchObject({ state: "violation", gap: null });
    expect(by.big).not.toHaveProperty("failedTests");
  });

  it("names them on a CC exception's function whose evidence reads test-failed (D8)", () => {
    const debt = fn("debt", [1, 5], 22);
    const approved: ExceptionEntry = {
      path: "src/a.ts",
      qualifiedName: "debt",
      bodyHash: debt.bodyHash,
      baseCommit: "c".repeat(40),
      measure: "complexity",
      kind: "approved",
      value: 22,
      issue: "https://example.com/1",
      approver: "owner",
    };
    const loader = testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [debt])]);
    const outside = testFile("test/b.test.ts", ["src/b.ts"], [], { failed: ["b > breaks"] });
    const { by, report } = judged(
      [{ path: "src/a.ts", functions: [debt], changed: ["debt"], added: ["debt"] }],
      [loader, outside],
      { exceptions: [approved] },
    );
    expect(by.debt).toMatchObject({ state: "incomplete", gap: "test-failed" });
    expect(by.debt?.failedTests).toEqual([
      { path: "test/b.test.ts", tests: ["b > breaks"], from: "run", loader: false },
    ]);
    expect(report.verdict).toBe("incomplete");
  });
});
