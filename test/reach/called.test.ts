import { describe, expect, it } from "vitest";
import type { CoverageSource } from "../../src/core/code/coverage/types.js";
import { lastLine, sourceCalls } from "../../src/core/reach/called.js";
import { answerRecord } from "./v8-payload.js";

/*
 * Review 0.1.415 B1 (spec 015 D11 "Coverage per pair"): a called function
 * at line 1, column 0 reads called; the module's top level alone reads
 * loaded only; a record that cannot tell the two apart reads uncertain.
 */

const answer = (call: boolean) => {
  const source = answerRecord(call).record.sources.find((s) => s.path === "src/answer.mjs");
  if (source === undefined) throw new Error("no record of src/answer.mjs");
  return source;
};

/** A source of `functions`, lines 1 to `last` with code. */
const source = (functions: CoverageSource["functions"], last = 2): CoverageSource => ({
  path: "src/a.ts",
  blob: "b",
  lines: Buffer.from([(1 << last) - 1]).toString("base64"),
  covered: "",
  functions,
});

describe("sourceCalls", () => {
  it("reads a called first-line function called, from a real V8 payload", () => {
    const called = answer(true);
    // The review's evidence: the function and the module both start at 1:0.
    expect(called.functions).toEqual([
      [1, 0, 1, 31, 1],
      [1, 0, 2, 18, 1],
    ]);
    expect(sourceCalls(called, null)).toBe("called");
  });

  it("reads the same module loaded only when the test only imports it", () => {
    const loaded = answer(false);
    expect(loaded.functions.filter((f) => f[4] === 1)).toEqual([[1, 0, 2, 18, 1]]);
    expect(sourceCalls(loaded, null)).toBe("loaded only");
  });

  it("reads a first-line function called when Vitest's record leaves the top level out", () => {
    expect(sourceCalls(source([[1, 0, 1, 31, 1]]), null)).toBe("called");
  });

  it("reads one entry spanning the whole source uncertain, unless the counter finds no function on line 1", () => {
    const whole = source([[1, 0, 2, 18, 1]]);
    expect(sourceCalls(whole, null)).toBe("uncertain");
    expect(sourceCalls(whole, true)).toBe("uncertain");
    expect(sourceCalls(whole, false)).toBe("loaded only");
  });

  it("reads the module beside a function of its own span loaded only, the module being the one hit", () => {
    const pair = source([
      [1, 0, 2, 18, 0],
      [1, 0, 2, 18, 1],
    ]);
    expect(sourceCalls(pair, null)).toBe("loaded only");
  });

  it("finds the last line with code in a record's bitset", () => {
    expect(lastLine(Buffer.from([0b101, 0b10]).toString("base64"))).toBe(10);
    expect(lastLine("")).toBeNull();
  });
});
