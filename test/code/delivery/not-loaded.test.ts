import { describe, expect, it } from "vitest";
import { codeLines } from "../../../src/core/delivery/code-format.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import type { CodeDeltaEntry, CodeDeltaKind } from "../../../src/core/types/code-delivery.js";

/*
 * Spec 020 D11.5 (row 020-07a): a file no test Squeal runs loads reads not
 * measured, so its functions have no failing state, and no line says "no
 * test Squeal runs loads this file" (row 015-103's words are gone). A line
 * whose loader count reads none, as a state judged before the upgrade
 * drops can give, claims no count: it says only that no test runs it.
 */

const LIMIT = "Squeal does not measure worker threads or child processes.";
const QUIET =
  "Squeal stays quiet about it until a test runs it in its own thread, and squeal code scripts/changelog.mjs shows its coverage.";
const AT = "renderRelease (scripts/changelog.mjs:12)";

/** `renderRelease`'s change of `measure`: complexity 6, CRAP 42, no line ran, no loader read. */
const entry = (measure: CodeMeasure, kind: CodeDeltaKind): CodeDeltaEntry => ({
  check: {
    kind: "code",
    path: "scripts/changelog.mjs",
    qualifiedName: "renderRelease",
    occurrence: 0,
  },
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

describe("a line whose file's loader count reads none (spec 020 D11.5)", () => {
  it("says no test runs it, with no count, on a FAIL line", () => {
    expect(lines(entry("uncovered", "first-seen-fail"))).toEqual([
      `FAIL untested: ${AT}: no test runs it in the test's own thread (complexity 6, CRAP 42). ${LIMIT}`,
    ]);
    expect(lines(entry("crap", "first-seen-fail"))).toEqual([
      `FAIL CRAP: ${AT}: 42, over 30 (complexity 6; no test runs it in the test's own thread). ${LIMIT}`,
    ]);
  });

  it("says so after an edit too, and never that no test Squeal runs loads the file", () => {
    const after = lines(entry("uncovered", "edited"));
    expect(after).toEqual([
      `STILL FAIL untested: ${AT}: no test runs it in the test's own thread after the edit, nor did one before it (complexity 6, CRAP 42). ${LIMIT} ${QUIET}`,
    ]);
    expect(after.join("\n")).not.toContain("no test Squeal runs loads");
  });
});
