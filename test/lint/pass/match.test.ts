import { describe, expect, it } from "vitest";
import { lintFingerprint } from "../../../src/core/lint/fingerprint.js";
import { lintTransition, matchFindings } from "../../../src/core/lint/transition.js";
import { finding } from "../helpers.js";

/* Review 0.1.344 S1: the match counts occurrences, not object identities. */

describe("the findings added and removed with one object twice (review 0.1.344 S1)", () => {
  const f = finding("no-undef", "'report' is not defined.", 1, "same");

  it("names the one removed in the first stage: rule, message and line text", () => {
    expect(lintFingerprint([f, f])).not.toBe(lintFingerprint([f]));
    expect(lintTransition([f, f], [f])).toEqual({ kind: "fail-changed", added: [], removed: [f] });
    expect(matchFindings([f, f, f], [f])).toEqual({ added: [], removed: [f, f] });
  });

  it("names the one removed in the second stage: rule and message alone", () => {
    const moved = { ...f, line: 9, lineHash: finding(null, "", 9, "other").lineHash };
    expect(matchFindings([f, f], [moved])).toEqual({ added: [], removed: [f] });
    expect(matchFindings([moved], [f, f])).toEqual({ added: [f], removed: [] });
  });
});
