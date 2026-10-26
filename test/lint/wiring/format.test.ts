import { describe, expect, it } from "vitest";
import {
  type LintDeltaEntry,
  lintEntryLine,
  lintLines,
  lintRegistrationLine,
  lintTitleWords,
} from "../../../src/core/delivery/lint-format.js";
import type { LintTransitionKind } from "../../../src/core/types/lint.js";

/* Spec 017 D8: the lint lines a delivery and a registration show. */

const UNUSED = { rule: "no-unused-vars", message: "'count' is assigned a value but never used." };
const FLOATING = {
  rule: "@typescript-eslint/no-floating-promises",
  message: "Promises must be awaited.",
};
const CONSOLE = { rule: "no-console", message: "Unexpected console statement." };

function entry(
  kind: LintTransitionKind,
  path: string,
  findings: number,
  added: LintDeltaEntry["added"] = [],
  removed: LintDeltaEntry["removed"] = [],
): LintDeltaEntry {
  return { kind, check: { kind: "lint", path, tool: "eslint" }, findings, added, removed };
}

describe("lint lines (017 D8)", () => {
  it("words a FAIL with the findings added and removed, a PASS and a removed file", () => {
    expect(lintEntryLine(entry("fail-changed", "src/a.ts", 2, [UNUSED]))).toBe(
      "FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars ('count' is assigned a value but never used.)",
    );
    expect(lintEntryLine(entry("fail-changed", "src/b.ts", 1, [FLOATING], [CONSOLE]))).toBe(
      "FAIL lint: src/b.ts: 1 finding, +1 @typescript-eslint/no-floating-promises (Promises must be awaited.), -1 no-console",
    );
    expect(lintEntryLine(entry("fail-to-pass", "src/a.ts", 0, [], [UNUSED]))).toBe(
      "PASS lint: src/a.ts: no findings",
    );
    expect(lintEntryLine(entry("removed", "src/c.ts", 0))).toBe(
      "RESOLVED lint: src/c.ts: no longer linted",
    );
  });

  it("counts one rule's findings together and names a parse error by its message", () => {
    const second = { rule: "no-console", message: "Unexpected console statement." };
    const parse = { rule: null, message: "Parsing error: ')' expected.\nat line 3" };
    expect(lintEntryLine(entry("first-seen-fail", "src/d.ts", 3, [CONSOLE, second, parse]))).toBe(
      "FAIL lint: src/d.ts: 3 findings, +2 no-console (Unexpected console statement.), +1 Parsing error: ')' expected.",
    );
  });

  it("drops a rule's message when its findings say different things", () => {
    const other = { rule: "no-console", message: "Unexpected console.log." };
    expect(lintEntryLine(entry("pass-to-fail", "src/e.ts", 2, [CONSOLE, other]))).toBe(
      "FAIL lint: src/e.ts: 2 findings, +2 no-console",
    );
  });

  it("orders the summaries before the changes and counts the rest", () => {
    const lines = lintLines(
      {
        v: 1,
        entries: [entry("pass-to-fail", "src/a.ts", 1, [UNUSED])],
        more: 3,
        configChange: { failing: 14 },
        unknown: { reason: "eslint.config.js does not load: Cannot find package 'x'." },
      },
      "squeal",
    );
    expect(lines).toEqual([
      "Lint config changed: 14 files with findings now; squeal lint lists them.",
      "Lint: unknown: eslint.config.js does not load: Cannot find package 'x'.",
      "FAIL lint: src/a.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.)",
      "and 3 more lint changes; squeal lint --changed lists them.",
    ]);
  });

  it("titles the changes, listed or by number, and nothing for a summary alone", () => {
    const one = entry("fail-to-pass", "src/a.ts", 0);
    expect(lintTitleWords({ v: 1, entries: [one], more: 0 })).toBe("1 lint change");
    expect(lintTitleWords({ v: 1, entries: [one], more: 5 })).toBe("6 lint changes");
    expect(lintTitleWords({ v: 1, entries: [], more: 0, configChange: { failing: 2 } })).toBeNull();
  });

  it("registers by count, by the first pass's progress, or why lint is off", () => {
    expect(lintRegistrationLine({ v: 1, failing: 12 }, "squeal")).toBe(
      "Lint: 12 files with findings; squeal lint lists them.",
    );
    expect(
      lintRegistrationLine({ v: 1, failing: 0, linting: { done: 340, total: 600 } }, "sq"),
    ).toBe("Lint: linting, 340 of 600 files.");
    expect(
      lintRegistrationLine({ v: 1, failing: 0, off: "ESLint 8 is not supported." }, "squeal"),
    ).toBe("Lint: off: ESLint 8 is not supported.");
  });
});
