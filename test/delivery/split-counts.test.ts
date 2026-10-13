import { describe, expect, it } from "vitest";
import {
  formatDelta,
  formatRegistration,
  headerLines,
  MESSAGE_CAP_CHARS,
} from "../../src/core/delivery/index.js";
import type {
  CheckId,
  Delta,
  DeltaEntry,
  KnownFailure,
  KnownOutcome,
  RetiredEntry,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

/*
 * Spec 005 D1, review wave 3 B1: every count of checks a delivery prints
 * names its tests and file-level checks apart, with test and file-level
 * entries mixed: titles, grouped heads, collapsed lists and overflow.
 */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const header: StatusHeader = {
  revision: 7,
  counts: { current: 10, pending: 0, stale: 0, unknown: 0 },
  fileLevelCounts: { current: 3, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};

const test = (path: string, name: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName: name,
});
const file = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });

function change(check: CheckId, from: KnownOutcome | null, to: KnownOutcome): TransitionEntry {
  return {
    check,
    kind: to === "fail" ? "first-seen-fail" : to === "pass" ? "fail-to-pass" : "to-unknown",
    from,
    to,
    validity: "current",
    observedAt: 7,
    origin: { kind: "own" },
    summary: to === "unknown" ? "the worker crashed" : null,
    location: null,
  };
}

function retired(check: CheckId): RetiredEntry {
  return { check, kind: "fail-retired", from: "fail", to: null, fingerprint: null, observedAt: 7 };
}

function delta(entries: DeltaEntry[], extra: Partial<Delta> = {}): Delta {
  return { schemaVersion: 1, consumer, header, label: "transitions", entries, ...extra };
}

/** Three tests and the file-level check of each of `files` test files. */
function mixed(files: number, prefix = "m"): CheckId[] {
  return Array.from({ length: files }, (_, i) => {
    const path = `tests/${prefix}${i}.test.ts`;
    return [test(path, "a"), test(path, "b"), test(path, "c"), file(path)];
  }).flat();
}

const lines = (text: string) => text.split("\n");

describe("split counts in deliveries (spec 005 D1, review wave 3 B1)", () => {
  it("names tests and file-level checks apart in the change and baseline titles", () => {
    const entries = [change(test("tests/a.test.ts", "a"), "pass", "fail")];
    entries.push(change(file("tests/b.test.ts"), null, "fail"));
    expect(lines(formatDelta(delta(entries)))[0]).toBe(
      "SQUEAL · 2 checks changed (1 test, 1 test file loaded) at revision 7",
    );
    expect(lines(formatDelta(delta(entries, { label: "baseline" })))[0]).toBe(
      "SQUEAL · Squeal's baseline run found 2 failing checks (1 test, 1 test file that did not load) at revision 7",
    );
  });

  it("splits a collapsed recovery's head, its per-file lines and what still fails", () => {
    const recovered = mixed(3, "r").map((c) => change(c, "fail", "pass"));
    const failing = [test("tests/x.test.ts", "one"), file("tests/y.test.ts")];
    const text = formatDelta(delta(recovered, { stillFailing: failing }));
    expect(text).toContain(
      "PASS  12 checks (9 tests, 3 test files loaded) recovered (FAIL -> PASS)",
    );
    expect(text).toContain("      still failing: 2 (1 test, 1 test file that did not load)");

    const many = formatDelta(delta(recovered, { stillFailing: mixed(4, "f") }));
    expect(many).toContain("      3 tests, 1 test file loaded in tests/r0.test.ts");
  });

  it("splits the count of test files past ten in a grouped list", () => {
    const recovered = mixed(12, "g").map((c) => change(c, "fail", "pass"));
    const text = formatDelta(delta(recovered));
    expect(text).toContain("      and 2 more test files (6 tests, 2 test files loaded)");
  });

  it("splits retired and unknown groups", () => {
    const gone = formatDelta(delta(mixed(2, "z").map(retired)));
    expect(gone).toContain(
      "RESOLVED  8 checks (6 tests, 2 test files loaded) no longer reported by the runner (FAIL -> RESOLVED)",
    );
    const unknown = formatDelta(
      delta([
        change(test("tests/u.test.ts", "a"), "pass", "unknown"),
        change(file("tests/u.test.ts"), "pass", "unknown"),
        change(test("tests/v.test.ts", "b"), "fail", "unknown"),
      ]),
    );
    expect(unknown).toContain("UNKNOWN  3 checks (2 tests, 1 test file loaded) in 2 test files");
    expect(unknown).toContain(
      "      PASS -> UNKNOWN (1 test, 1 test file loaded), FAIL -> UNKNOWN (1 test)",
    );
  });

  it("splits each overflow count, under the cap, with the pointer whole", () => {
    const failures = mixed(250, "o").map((c) => change(c, "pass", "fail"));
    const unknown = mixed(50, "u").map((c) => change(c, "pass", "unknown"));
    const recovered = mixed(3, "p").map((c) => change(c, "fail", "pass"));
    const gone = mixed(3, "q").map(retired);
    const command = `/home/someone/.codex/plugins/cache/hearsay/squeal/${"x".repeat(60)}/bin/squeal`;
    const text = formatDelta(delta([...failures, ...unknown, ...recovered, ...gone]), command);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    const notShown = lines(text).find((l) => l.startsWith("Not shown: "));
    expect(notShown).toMatch(
      /^Not shown: \d+ more changed checks \(\d+ tests, \d+ test files loaded\): \d+ FAIL \(\d+ tests, \d+ test files that did not load\), 12 PASS \(9 tests, 3 test files loaded\), 200 UNKNOWN \(150 tests, 50 test files loaded\), 12 RESOLVED \(9 tests, 3 test files loaded\)\. `.+ status` lists every known failure\.$/,
    );
    expect(lines(text).at(-1)).toMatch(/^Full output: .+ why /);
  });

  it("splits a registration's overflow count, under the cap", () => {
    const failures: KnownFailure[] = mixed(500, "k").map((check) => ({
      check,
      outcome: "fail",
      validity: "current",
      observedAt: 7,
      summary: "expected 401, received 500",
      fingerprint: "AssertionError",
      location: null,
    }));
    const text = formatRegistration({
      schemaVersion: 1,
      consumer,
      header,
      knownFailures: failures,
    });
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(text).toMatch(
      /\nNot shown: \d+ more known failures \(\d+ tests, \d+ test files that did not load\)\. `squeal status` lists every known failure\.\n/,
    );
  });

  it("prints an inherited count whole from a header without its file-level part", () => {
    const old = { ...header, inheritedCount: 4 };
    expect(headerLines(old, "squeal")[0]).toContain(" Inherited: 4 of 10 current. ");
    const split = { ...old, inheritedFileLevelCount: 1 };
    expect(headerLines(split, "squeal")[0]).toContain(
      " Inherited: 4 of 10 current (3 tests, 1 test file loaded). ",
    );
  });
});
