import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // Lessons, defect 2: test/daemon/lifecycle.test.ts failed at load with this
  // line, and every re-run was delivered as FAIL -> FAIL, failure changed.
  it("ignores the random cache directory of the lifecycle load failure", () => {
    const line = (id: string) =>
      "Command failed: /usr/local/bin/node node_modules/typescript/bin/tsc -p tsconfig.build.json " +
      `--outDir node_modules/.cache/squeal-test/${id}/dist`;
    const a = describeFailure([error(line("d80d9776-3b1e-4f0a-9c2d-5e6f7a8b9c0d"))], null);
    const b = describeFailure([error(line("1c2b3a49-0f8e-4d7c-a6b5-c4d3e2f1a0b9"))], null);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toContain("tsc -p tsconfig.build.json --outDir");
  });

  it("ignores UUIDs and hex identifiers of 16 or more characters", () => {
    const a = describeFailure(
      [
        error(
          "run 0F8E4D7C-A6B5-4C4D-93E2-F1A0B9C8D7E6 of commit 1de13c7a9b2f4e6d8c0a1b3c5d7e9f02 failed",
        ),
      ],
      null,
    );
    const b = describeFailure(
      [
        error(
          "run 5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b of commit e8abd21f00c4b9a3d7e6f5a4b3c2d1e0 failed",
        ),
      ],
      null,
    );
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("keeps short hex, plain numbers and other values", () => {
    const base = describeFailure([error("expected 1234567890123456 to be abc1234")], null);
    expect(
      describeFailure([error("expected 1234567890123457 to be abc1234")], null).fingerprint,
    ).not.toBe(base.fingerprint);
    expect(
      describeFailure([error("expected 1234567890123456 to be abc1235")], null).fingerprint,
    ).not.toBe(base.fingerprint);
  });

  it("ignores the random directory under the temp directory", () => {
    const at = (dir: string) =>
      describeFailure(
        [error(`ENOENT: no such file, open '${join(tmpdir(), dir, "a.json")}'`)],
        null,
      ).fingerprint;
    expect(at("squeal-e2e-Xy12Ab")).toBe(at("squeal-e2e-Qr98Zt"));
    expect(at("squeal-e2e-Xy12Ab")).toContain("a.json");
    expect(
      describeFailure([error("ENOENT: no such file, open '/tmp/squeal-AbCdEf/b.json'")], null)
        .fingerprint,
    ).toBe(
      describeFailure([error("ENOENT: no such file, open '/tmp/squeal-GhIjKl/b.json'")], null)
        .fingerprint,
    );
  });

  it("keeps a tmp directory inside the project", () => {
    expect(
      describeFailure([error("cannot open /repo/tmp/fixture-a/x.json")], null).fingerprint,
    ).not.toBe(
      describeFailure([error("cannot open /repo/tmp/fixture-b/x.json")], null).fingerprint,
    );
  });

  it("ignores node_modules/.cache paths", () => {
    const at = (dir: string) =>
      describeFailure([error(`cannot read /repo/node_modules/.cache/vite/${dir}/deps.js`)], null)
        .fingerprint;
    expect(at("deps_temp_a1b2c3")).toBe(at("deps_temp_z9y8x7"));
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
