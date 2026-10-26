import { describe, expect, it } from "vitest";
import { eslintFindings } from "../../src/core/lint/eslint.js";
import { lineHash, lintFingerprint } from "../../src/core/lint/fingerprint.js";
import { lintTransition, matchFindings } from "../../src/core/lint/transition.js";
import { finding } from "./helpers.js";

/* Spec 017 D2: a lint check's fingerprint and its transition table, one test per row. */

const unused = finding("no-unused-vars", "'count' is assigned a value but never used.", 4);
const undef = finding("no-undef", "'report' is not defined.", 5);
const consoleLog = finding("no-console", "Unexpected console statement.", 7);

describe("the lint fingerprint (017 D2)", () => {
  it("is the sorted rule and message of every finding: no line, no column, no order", () => {
    const moved = { ...unused, line: 40, column: 9, lineHash: lineHash("elsewhere") };
    expect(lintFingerprint([unused, undef])).toBe(lintFingerprint([undef, moved]));
    expect(lintFingerprint([unused])).not.toBe(lintFingerprint([{ ...unused, message: "other" }]));
    expect(lintFingerprint([unused])).not.toBe(lintFingerprint([{ ...unused, rule: "other" }]));
  });

  it("keeps duplicates: a second equal finding changes it (016-33 s3)", () => {
    expect(lintFingerprint([undef, unused])).not.toBe(lintFingerprint([undef, undef, unused]));
  });

  it("is null with no finding, and a `|` in a message is no separator", () => {
    expect(lintFingerprint([])).toBeNull();
    expect(lintFingerprint([finding("a|b", "c")])).not.toBe(lintFingerprint([finding("a", "b|c")]));
  });
});

describe("the lint transition table (017 D2)", () => {
  it("a file linted for the first time, with findings: first-seen fail, every finding added", () => {
    expect(lintTransition(null, [unused, undef])).toEqual({
      kind: "first-seen-fail",
      added: [unused, undef],
      removed: [],
    });
    // With none, nothing is recorded.
    expect(lintTransition(null, [])).toBeNull();
  });

  it("pass to fail: PASS -> FAIL, with its findings", () => {
    expect(lintTransition([], [undef])).toEqual({
      kind: "pass-to-fail",
      added: [undef],
      removed: [],
    });
  });

  it("fail to pass: FAIL -> PASS, every finding removed", () => {
    expect(lintTransition([unused, undef], [])).toEqual({
      kind: "fail-to-pass",
      added: [],
      removed: [unused, undef],
    });
  });

  it("fail to fail with the fingerprint changed: FAIL -> FAIL, with the findings added and removed", () => {
    expect(lintTransition([unused, consoleLog], [unused, undef])).toEqual({
      kind: "fail-changed",
      added: [undef],
      removed: [consoleLog],
    });
  });

  it("fail to fail with the same fingerprint: nothing, even when every line moved", () => {
    const moved = [undef, unused].map((f) => ({ ...f, line: f.line + 10, lineHash: "moved" }));
    expect(lintTransition([unused, undef], moved)).toBeNull();
    expect(lintTransition([], [])).toBeNull();
  });

  it("a file deleted or excluded while fail: resolved, once; while pass: nothing", () => {
    expect(lintTransition([unused], null)).toEqual({
      kind: "removed",
      added: [],
      removed: [unused],
    });
    expect(lintTransition([], null)).toBeNull();
    expect(lintTransition(null, null)).toBeNull();
  });

  it("a config or ESLint change: nothing per file, whatever the findings did", () => {
    for (const [before, after] of [
      [null, [unused]],
      [[], [unused]],
      [[unused], []],
      [[unused], [undef]],
      [[unused], null],
    ] as const) {
      expect(lintTransition(before, after, "config")).toBeNull();
    }
  });
});

describe("the findings added and removed (017 D2, as evidence)", () => {
  it("matches on rule, message and line text first, so the right one of two is named", () => {
    const first = finding("no-undef", "'report' is not defined.", 5, "report(1);");
    const second = finding("no-undef", "'report' is not defined.", 9, "report(2);");
    const kept = { ...second, line: 8 };
    expect(matchFindings([first, second], [kept])).toEqual({ added: [], removed: [first] });
  });

  it("then on rule and message, so a finding whose line text changed is not named twice", () => {
    const before = finding("no-undef", "'report' is not defined.", 5, "report(1);");
    const edited = finding("no-undef", "'report' is not defined.", 5, "report(10);");
    const added = finding("no-undef", "'report' is not defined.", 9, "report(3);");
    expect(matchFindings([before], [edited, added])).toEqual({ added: [added], removed: [] });
  });

  it("names a renamed variable's finding as one added and one removed: its message changed", () => {
    const tally = finding("no-unused-vars", "'tally' is assigned a value but never used.", 4);
    expect(matchFindings([unused, undef], [tally, undef])).toEqual({
      added: [tally],
      removed: [unused],
    });
  });
});

describe("ESLint's messages as findings (017 D6)", () => {
  it("keeps rule, message, severity and place, and hashes the line's text without whitespace", () => {
    const text = "const a = 1;\n  report( 1 );\n";
    const found = eslintFindings(
      [
        {
          ruleId: "no-undef",
          severity: 2,
          message: "'report' is not defined.",
          line: 2,
          column: 3,
        },
        { ruleId: "no-console", severity: 1, message: "Unexpected console.", line: 1, column: 1 },
        // A message that names no place, as ESLint's own warnings: line and column 0.
        { ruleId: null, severity: 1, message: "File ignored by default." },
      ],
      text,
    );
    expect(found).toEqual([
      { ...finding("no-undef", "'report' is not defined.", 2, "report(1);"), column: 3 },
      { ...finding("no-console", "Unexpected console.", 1, "const a = 1;"), severity: "warning" },
      { ...finding(null, "File ignored by default.", 0, ""), severity: "warning", column: 0 },
    ]);
  });
});
