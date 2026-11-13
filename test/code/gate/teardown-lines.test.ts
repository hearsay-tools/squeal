import { describe, expect, it } from "vitest";
import { TeardownWarnings, teardownLines } from "../../../src/core/code/gate/evidence.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";

/*
 * Row 020-50 (#207): a file whose worker Vitest timed out terminating gets
 * one stderr line saying whether its result counts in this report, from its
 * final evidence; never whether it was stored or kept.
 */

function file(
  path: string,
  completed: boolean,
  more: Partial<TestFileEvidence> = {},
): TestFileEvidence {
  return {
    runner: "vitest",
    path,
    completed,
    failed: [],
    skipped: false,
    loads: [],
    record: null,
    ...more,
  };
}

const lead = (path: string) => `squeal code: Vitest timed out terminating the worker of ${path}; `;

describe("teardownLines (#207)", () => {
  it("says a completed file's result counts, its failed tests included", () => {
    const files = [
      file("test/pass.test.ts", true),
      file("test/fail.test.ts", true, { failed: ["adds"] }),
    ];
    expect(teardownLines(["test/pass.test.ts", "test/fail.test.ts"], files)).toEqual([
      `${lead("test/fail.test.ts")}the file completed, so its result counts in this report, 1 failed test included.\n`,
      `${lead("test/pass.test.ts")}the file completed, so its result counts in this report.\n`,
    ]);
  });

  it("says a file the report lists as not finished does not count", () => {
    expect(teardownLines(["test/pass.test.ts"], [file("test/pass.test.ts", false)])).toEqual([
      `${lead("test/pass.test.ts")}the report lists the file as not finished, so its result does not count.\n`,
    ]);
  });

  it("names the projects a file completed in when only some did", () => {
    const files = [
      file("test/a.test.ts", true, { failed: ["x", "y"] }),
      file("test/a.test.ts", false),
    ];
    expect(teardownLines(["test/a.test.ts"], files)).toEqual([
      `${lead("test/a.test.ts")}the file completed in 1 of its 2 projects, so its result counts in this report for those only, 2 failed tests included.\n`,
    ]);
  });

  it("gives no line with no warning, and none for a file this command did not run", () => {
    const files = [
      file("test/pass.test.ts", true),
      file("test/stored.test.ts", true, { from: "store" }),
      file("test/node.test.ts", true, { runner: "node-test" }),
    ];
    expect(teardownLines([], files)).toEqual([]);
    expect(
      teardownLines(["test/stored.test.ts", "test/node.test.ts", "test/other.test.ts"], files),
    ).toEqual([]);
  });

  it("never claims a result was stored or kept", () => {
    const lines = teardownLines(
      ["a", "b", "c"],
      [file("a", true), file("b", false), file("c", true, { failed: ["x"] })],
    );
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).not.toMatch(/stor|kept|keep|sav/i);
  });
});

describe("TeardownWarnings (#207)", () => {
  it("writes one line per file heard, once, sorted", () => {
    const warnings = new TeardownWarnings();
    warnings.hear(["test/b.test.ts", "test/a.test.ts"]);
    warnings.hear(["test/a.test.ts"]);
    const written: string[] = [];
    warnings.tell([file("test/a.test.ts", true), file("test/b.test.ts", false)], (text) =>
      written.push(text),
    );
    expect(written).toEqual([
      `${lead("test/a.test.ts")}the file completed, so its result counts in this report.\n`,
      `${lead("test/b.test.ts")}the report lists the file as not finished, so its result does not count.\n`,
    ]);
  });

  it("writes nothing when nothing was heard", () => {
    const written: string[] = [];
    new TeardownWarnings().tell([file("test/a.test.ts", true)], (text) => written.push(text));
    expect(written).toEqual([]);
  });
});
