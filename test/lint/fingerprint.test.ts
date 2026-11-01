import { describe, expect, it } from "vitest";
import { lineHash, lintFingerprint } from "../../src/core/lint/fingerprint.js";
import { judgeResult, resultOf } from "../../src/core/lint/pass/judge.js";
import type { LintFinding, LintKnownState, LintResult } from "../../src/core/types/lint.js";
import { check, finding } from "./helpers.js";

/* Spec 017 D2: a lint check's failure fingerprint, and a line number inside a message (row 017-22). */

const unused = finding("no-unused-vars", "'count' is assigned a value but never used.", 4);
const undef = finding("no-undef", "'report' is not defined.", 5);
const directive = finding(
  null,
  "Unused eslint-disable directive (no problems were reported from 'no-console').",
);

/** `react-hooks/exhaustive-deps` names the line of the Hook's dependencies (lessons.md L5, s3). */
function deps(name: string, line: number): LintFinding {
  return finding(
    "react-hooks/exhaustive-deps",
    `The '${name}' function makes the dependencies of useCallback Hook (at line ${line}) change on every render. To fix this, wrap the definition of '${name}' in its own useCallback() Hook.`,
    line - 30,
  );
}

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

describe("a line number inside a message (017-22, lessons.md L5)", () => {
  it("is no part of it: s3's pure move of two exhaustive-deps findings keeps the fingerprint", () => {
    const before = [deps("loadItems", 170), deps("toggle", 191)];
    const after = [deps("loadItems", 136), deps("toggle", 157)];
    expect(lintFingerprint(after)).toBe(lintFingerprint(before));
  });

  it("is read only in a known rule's template: every other message stays as it is", () => {
    const differ = (rule: string, a: string, b: string) =>
      expect(lintFingerprint([finding(rule, a)])).not.toBe(lintFingerprint([finding(rule, b)]));
    // Review 0.1.391 B1: the project's own text, which names no line of the file.
    differ(
      "no-restricted-imports",
      "'line 1' import is restricted from being used.",
      "'line 2' import is restricted from being used.",
    );
    // A rule not on the list keeps its number, even one that names a line of the file.
    differ(
      "sonarjs/no-identical-functions",
      "Update this function so that its implementation is not identical to the one on line 12.",
      "Update this function so that its implementation is not identical to the one on line 30.",
    );
    // The template under another rule's name is that rule's text.
    differ("other/rule", deps("load", 170).message, deps("load", 136).message);
    // The listed rule's message keeps every part but the line.
    differ(
      "react-hooks/exhaustive-deps",
      deps("loadItems", 170).message,
      deps("reload", 170).message,
    );
  });

  it("stays the hash of the release before for every set with no line in a message", () => {
    // Computed by the fingerprint before row 017-22: an upgrade moves no such file's fingerprint.
    expect(lintFingerprint([unused, undef, directive])).toBe("df70b396f31887cf");
  });
});

describe("an upgrade from the fingerprint before 017-22", () => {
  const at = { worktreeId: "w1", revision: 7, now: 7_000, cause: "edit" as const };

  /** A state judged `fail` at `key` under the old fingerprint, with that result stored or gone. */
  function judgedBefore(key: string, fingerprint: string): LintKnownState {
    return {
      worktreeId: "w1",
      check: check(),
      outcome: "fail",
      judged: { key, outcome: "fail", fingerprint, blob: "blob-1", revision: 3 },
      stale: false,
      reason: null,
      changedAt: 3,
    };
  }

  function results(stored: LintResult | null) {
    return { get: () => stored };
  }

  it("gives no transition for an unchanged file whose message names a line", () => {
    const findings = [deps("loadItems", 170)];
    // The old release stored this result and its fingerprint, with the line number in it.
    const old: LintResult = {
      ...resultOf("src/a.ts", "key-1", findings, "9.39.0", 1),
      fingerprint: "10ee168733c5f8a3",
    };
    const prior = judgedBefore("key-1", "10ee168733c5f8a3");
    // A cache hit at the same key, and a re-lint at a new key of the same bytes.
    expect(judgeResult(results(old), prior, old, "blob-1", at).transition).toBeNull();
    const again = resultOf("src/a.ts", "key-2", findings, "9.39.0", 7_000);
    expect(judgeResult(results(old), prior, again, "blob-1", at).transition).toBeNull();
  });

  it("gives no transition for an unchanged file with no line in a message, its result gone", () => {
    const findings = [unused, undef, directive];
    const prior = judgedBefore("key-1", "df70b396f31887cf");
    const again = resultOf("src/a.ts", "key-2", findings, "9.39.0", 7_000);
    expect(judgeResult(results(null), prior, again, "blob-1", at).transition).toBeNull();
  });
});
