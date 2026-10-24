import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import { checkKey, type Judged, judge } from "../../../src/core/code/pass/judge.js";
import type { CodeKnownState, CodeLanguage } from "../../../src/core/types/code.js";

/*
 * Review 0.1.283 B3: the real parser gives a missing token a zero-width
 * error. At a missing closing brace that point is the function's end, so
 * the function is `unknown` with no transition (D3), and a healthy function
 * beside it stays judged. These run the real counter into `judge`.
 */

const PATH = "src/a.ts";

/** `judge` of the real count of `text` at revision 2, after the states `before`. */
async function judged(
  text: string,
  {
    threshold = 1,
    before = [],
    language = "typescript",
  }: { threshold?: number; before?: readonly CodeKnownState[]; language?: CodeLanguage } = {},
): Promise<Judged> {
  const count = await countFile(text, language);
  return judge({
    worktreeId: "w1",
    revision: 2,
    threshold,
    at: 2_000,
    quiet: false,
    before,
    bodies: new Map(before.map((s) => [checkKey(s.check), `old-${s.check.qualifiedName}`])),
    after: [{ path: PATH, count }],
  });
}

const outcomes = (j: Judged) => j.states.map((s) => `${s.check.qualifiedName} ${s.outcome}`);
const kinds = (j: Judged) => j.transitions.map((t) => `${t.check.qualifiedName} ${t.kind}`);

/** The state of `qualifiedName` judged at revision 1, `cc` against `threshold`. */
function was(qualifiedName: string, cc: number, threshold: number): CodeKnownState {
  return {
    worktreeId: "w1",
    check: { kind: "code", path: PATH, qualifiedName, occurrence: 0 },
    measure: "complexity",
    outcome: cc > threshold ? "fail" : "pass",
    value: cc,
    threshold,
    countedAt: 1,
    blob: "blob-1",
    changedAt: 1,
  };
}

describe("a missing token's zero-width error (review 0.1.283 B3)", () => {
  it("makes the function whose end it touches unknown, with no transition", async () => {
    const j = await judged("function f(x) { if (x) return 1;");
    expect(outcomes(j)).toEqual(["f unknown"]);
    expect(j.transitions).toEqual([]);
  });

  it.each([
    ["a missing brace and a newline", "function f(x) { if (x) return 1;\n", ["f unknown"]],
    [
      "two missing braces before trailing spaces",
      "function f(x) {\n  if (x) {\n    return 1;\n  ",
      ["f unknown"],
    ],
    [
      "a class's missing brace after its method's",
      "class A { m(x) { if (x) return 1; }",
      ["A.m unknown"],
    ],
    [
      "a missing parenthesis after a callback",
      "foo(function () { if (x) return 1; }",
      ["<anonymous> unknown"],
    ],
    ["an object's missing brace", "const o = { m(x) { if (x) return 1; }", ["m unknown"]],
  ])("covers an end-of-file token: %s", async (_name, text, expected) => {
    const j = await judged(text);
    expect(outcomes(j)).toEqual(expected);
    expect(j.transitions).toEqual([]);
  });

  it("covers Python's end-of-file tokens", async () => {
    const j = await judged("def f(x):\n    if x:\n        return g(x", { language: "python" });
    expect(outcomes(j)).toEqual(["f unknown"]);
    expect(j.transitions).toEqual([]);
  });

  it("keeps a healthy function on the line before judged", async () => {
    const j = await judged("function g() { if (y) return 0; }\nfunction f(x) { if (x) return 1;");
    expect(outcomes(j)).toEqual(["g fail", "f unknown"]);
    expect(kinds(j)).toEqual(["g first-seen-fail"]);
  });

  it("keeps a healthy function that ends where the broken one starts judged", async () => {
    const text = "function g() { if (y) return 0 }function f(x) { if (x) return 1;";
    const count = await countFile(text, "typescript");
    // The shapes this pins: `g` ends at the column `f` starts at, the error is at `f`'s end.
    expect(
      count.functions.map((f) => [f.qualifiedName, f.range.startColumn, f.range.endColumn]),
    ).toEqual([
      ["g", 1, 33],
      ["f", 33, 65],
    ]);
    expect(count.errors).toEqual([{ startLine: 1, startColumn: 65, endLine: 1, endColumn: 65 }]);
    const j = await judged(text);
    expect(outcomes(j)).toEqual(["g fail", "f unknown"]);
    expect(kinds(j)).toEqual(["g first-seen-fail"]);
  });

  it("never recovers an existing failure through an incomplete edit", async () => {
    // At CC 3 over 2 before; the edit's incomplete body would count 2, at the threshold.
    const j = await judged("function f(x) { if (x) return 1;", {
      threshold: 2,
      before: [was("f", 3, 2)],
    });
    expect(outcomes(j)).toEqual(["f unknown"]);
    expect(j.transitions).toEqual([]);
  });

  it("never fails an existing pass through an incomplete edit", async () => {
    const j = await judged("function f(x) { if (x) return 1;", { before: [was("f", 1, 1)] });
    expect(outcomes(j)).toEqual(["f unknown"]);
    expect(j.transitions).toEqual([]);
  });

  it("leaves a function judged when a non-zero-width error starts at its end", async () => {
    const j = await judged("function f(x) { if (x) { return 1; }}\nconst y = ;\n");
    expect(outcomes(j)).toEqual(["f fail"]);
  });
});
