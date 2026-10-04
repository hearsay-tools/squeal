import { describe, expect, it } from "vitest";
import { describeFailure, SUMMARY_MAX_CHARS } from "../../src/core/state/index.js";
import type { CheckError, SourceLocation } from "../../src/core/types/index.js";

const at: SourceLocation = { path: "src/auth.ts", line: 42, column: 7 };

function error(message: string, overrides: Partial<CheckError> = {}): CheckError {
  return { name: "AssertionError", message, stack: null, location: at, diff: null, ...overrides };
}

describe("describeFailure fingerprint", () => {
  it("is the error name, the first message line and the location", () => {
    const { fingerprint } = describeFailure(
      [error("expected 401, received 500\nmore detail")],
      null,
    );
    expect(fingerprint).toBe("AssertionError: expected 401, received 500 @ src/auth.ts:42:7");
  });

  it("ignores ANSI colour, surrounding blank lines and repeated whitespace", () => {
    const plain = describeFailure([error("expected 1 to be 2")], null).fingerprint;
    const noisy = describeFailure(
      [error("\n\n  \u001b[31mexpected  1\tto be 2\u001b[39m  \n")],
      null,
    );
    expect(noisy.fingerprint).toBe(plain);
  });

  it("ignores durations, timestamps and memory addresses", () => {
    const a = describeFailure(
      [error("Test timed out in 5012ms at 2026-10-04T10:00:00.123Z 0x7ffd1")],
      null,
    );
    const b = describeFailure(
      [error("Test timed out in 5003 ms at 2026-10-05T11:12:13Z 0x10a2")],
      null,
    );
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("changes when the first line, the error name or the location changes", () => {
    const base = describeFailure([error("expected 1 to be 2")], null).fingerprint;
    expect(describeFailure([error("expected 1 to be 3")], null).fingerprint).not.toBe(base);
    expect(
      describeFailure([error("expected 1 to be 2", { name: "TypeError" })], null).fingerprint,
    ).not.toBe(base);
    expect(
      describeFailure([error("expected 1 to be 2", { location: { ...at, line: 43 } })], null)
        .fingerprint,
    ).not.toBe(base);
  });

  it("ignores the second line and later errors", () => {
    const a = describeFailure([error("boom\nfirst detail")], null).fingerprint;
    const b = describeFailure(
      [error("boom\nother detail"), error("second error")],
      null,
    ).fingerprint;
    expect(a).toBe(b);
  });

  it("falls back to the given location when the error has none", () => {
    const test: SourceLocation = { path: "src/auth.test.ts", line: 3, column: 5 };
    const { fingerprint } = describeFailure([error("boom", { location: null })], test);
    expect(fingerprint).toBe("AssertionError: boom @ src/auth.test.ts:3:5");
    expect(describeFailure([error("boom", { location: null })], null).fingerprint).toBe(
      "AssertionError: boom @ ?",
    );
  });

  it("describes a failure without errors", () => {
    expect(describeFailure([], at)).toEqual({
      fingerprint: "fail @ src/auth.ts:42:7",
      summary: "failed without an error message",
    });
  });
});

describe("describeFailure summary", () => {
  it("is the first non-empty message line without colour", () => {
    const { summary } = describeFailure(
      [error("\n\u001b[31mexpected 401, received 500\u001b[39m\nstack")],
      null,
    );
    expect(summary).toBe("expected 401, received 500");
  });

  it("counts further errors", () => {
    const { summary } = describeFailure([error("boom"), error("bang"), error("pow")], null);
    expect(summary).toBe("boom (2 more errors)");
  });

  it("uses the error name when the message is empty", () => {
    expect(describeFailure([error("", { name: "TypeError" })], null).summary).toBe("TypeError");
  });

  it("is capped", () => {
    const { summary } = describeFailure([error("x".repeat(5_000))], null);
    expect(summary.length).toBe(SUMMARY_MAX_CHARS);
    expect(summary.endsWith("...")).toBe(true);
  });
});
