import { describe, expect, it } from "vitest";
import {
  checkTextPattern,
  focusedTexts,
  holdsCheckText,
  type SeparatorRule,
} from "../../src/runners/focus.js";

/*
 * Row 011-135 R1 (spec 011 C14): a text is literal and selects a check when
 * its full name holds it; the runners' filters are built from one pattern.
 */
describe("focused-run texts", () => {
  const select = (texts: readonly string[], name: string, rule?: SeparatorRule) =>
    new RegExp(checkTextPattern(texts, rule)).test(name);

  it("reads each text literally, regular-expression characters included", () => {
    for (const rule of ["separator", "separator-or-space"] as const) {
      expect(select(["a (1) [x] *+?.$^|\\"], "a (1) [x] *+?.$^|\\ b", rule)).toBe(true);
      expect(select(["a.c"], "abc", rule)).toBe(false);
    }
    expect(holdsCheckText("a.c > b", ["a.c"])).toBe(true);
    expect(holdsCheckText("A > b", ["a"])).toBe(false);
  });

  it("matches each ` > ` as ` > ` or a space by default, the joins of Vitest 4 and node:test", () => {
    expect(select(["parity > new 1"], "parity > new 1")).toBe(true);
    expect(select(["parity > new 1"], "parity new 1")).toBe(true);
    expect(select(["parity > new 1"], "parity>new 1")).toBe(false);
  });

  // Row 011-173 (review 0.1.278 N1): Vitest 5's filter reads the ` > ` join only.
  it("matches each ` > ` as ` > ` alone under the separator rule, as `holdsCheckText` does", () => {
    expect(select(["parity > new 1"], "parity > new 1", "separator")).toBe(true);
    expect(select(["parity > new 1"], "parity new 1", "separator")).toBe(false);
    expect(select(["a > b"], "a b", "separator")).toBe(holdsCheckText("a b", ["a > b"]));
  });

  it("selects a check holding any text, and nothing for no text", () => {
    expect(select(["old", "top"], "new 3 top")).toBe(true);
    expect(select([], "")).toBe(false);
    expect(select([], "anything")).toBe(false);
  });

  it("joins the texts of a file's entries, matched by project and path", () => {
    const a = { project: "p", path: "a.test.ts" };
    const checks = [
      { testFile: a, texts: ["x"] },
      { testFile: { project: "q", path: "a.test.ts" }, texts: ["y"] },
      { testFile: a, texts: ["x", "z"] },
    ];
    expect(focusedTexts(checks, a)).toEqual(["x", "z"]);
    expect(focusedTexts(checks, { project: "p", path: "b.test.ts" })).toBeNull();
    expect(focusedTexts(undefined, a)).toBeNull();
  });
});
