import { describe, expect, it } from "vitest";
import { codeLines } from "../../../src/core/delivery/code-format.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import type { CodeDeltaEntry, CodeDeltaKind } from "../../../src/core/types/code-delivery.js";

/*
 * Row 015-103 (spec 015 D9 Delivery): a line whose file no test Squeal runs
 * loads says so as a fact about the tests Squeal runs, never as a claim
 * that no test loads it. In eval run `20261101T092538Z-135e02` the
 * node:test file `scripts/changelog.test.mjs`, which Squeal does not run,
 * loaded `scripts/changelog.mjs`, and the line said "no test file loads
 * this file". Each form that composes the reason is pinned here.
 */

const LIMIT = "Squeal does not measure worker threads or child processes.";
const QUIET =
  "Squeal stays quiet about it until a test runs it in its own thread, and squeal code scripts/changelog.mjs shows its coverage.";
const QUIET_CRAP =
  "Squeal stays quiet about it until it is at or under 30, and squeal code scripts/changelog.mjs shows its CRAP.";
const AT = "renderRelease (scripts/changelog.mjs:12)";

/** `renderRelease`'s change of `measure`: complexity 6, CRAP 42, no line ran, no loader read. */
const entry = (measure: CodeMeasure, kind: CodeDeltaKind): CodeDeltaEntry => ({
  check: { kind: "code", path: "scripts/changelog.mjs", qualifiedName: "renderRelease", occurrence: 0 },
  measure,
  kind,
  value: measure === "crap" ? 42 : null,
  threshold: measure === "crap" ? 30 : null,
  line: 12,
  revision: 3,
  evidence: { complexity: 6, lines: 5, covered: 0, testFiles: 0, first: [], crap: 42 },
  fileLoaders: { count: 0 },
});
const lines = (...entries: CodeDeltaEntry[]) => codeLines({ v: 1, entries, more: 0 }, "squeal");

describe("the line of a file no test Squeal runs loads (row 015-103)", () => {
  it("says so on a FAIL line of its own", () => {
    expect(lines(entry("uncovered", "first-seen-fail"))).toEqual([
      `FAIL untested: ${AT}: no test Squeal runs loads this file (complexity 6, CRAP 42). ${LIMIT}`,
    ]);
    expect(lines(entry("crap", "first-seen-fail"))).toEqual([
      `FAIL CRAP: ${AT}: 42, over 30 (complexity 6; no test Squeal runs loads this file). ${LIMIT}`,
    ]);
  });

  it("says so in a function's block, on the untested line only", () => {
    expect(lines(entry("crap", "first-seen-fail"), entry("uncovered", "first-seen-fail"))).toEqual([
      `${AT}:`,
      `- FAIL untested: no test Squeal runs loads this file. ${LIMIT}`,
      "- FAIL CRAP: 42, over 30 (complexity 6)",
    ]);
  });

  it("says so after an edit, and that none loaded it before the edit either", () => {
    expect(lines(entry("uncovered", "edited-after-fail"))).toEqual([
      `STILL FAIL untested: ${AT}: no test Squeal runs loads this file after the edit (complexity 6, CRAP 42). ${LIMIT} ${QUIET}`,
    ]);
    expect(lines(entry("uncovered", "edited"))).toEqual([
      `STILL FAIL untested: ${AT}: no test Squeal runs loads this file after the edit, nor did one before it (complexity 6, CRAP 42). ${LIMIT} ${QUIET}`,
    ]);
    expect(lines(entry("crap", "edited"))).toEqual([
      `STILL FAIL CRAP: ${AT}: 42 after the edit; it was already over 30 before it (complexity 6; no test Squeal runs loads this file). ${LIMIT} ${QUIET_CRAP}`,
    ]);
  });

  it("says so in a STILL FAIL block", () => {
    expect(lines(entry("crap", "edited"), entry("uncovered", "edited"))).toEqual([
      `${AT}:`,
      `- STILL FAIL untested: no test Squeal runs loads this file after the edit, nor did one before it. ${LIMIT} ${QUIET}`,
      `- STILL FAIL CRAP: 42 after the edit; it was already over 30 before it (complexity 6); ${QUIET_CRAP}`,
    ]);
  });
});
