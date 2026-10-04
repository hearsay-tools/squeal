import { describe, expect, it } from "vitest";
import {
  formatDelta,
  formatRegistration,
  MESSAGE_CAP_CHARS,
} from "../../src/core/delivery/index.js";
import type {
  Delta,
  DeltaEntry,
  KnownFailure,
  Registration,
  RetiredEntry,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const header: StatusHeader = {
  revision: 184,
  counts: { current: 47, pending: 3, stale: 0, unknown: 12 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: 170 },
};

function test(path: string, fullName: string) {
  return { kind: "test" as const, project: "", testPath: path, fullName };
}

function entry(
  overrides: Partial<TransitionEntry> & Pick<TransitionEntry, "kind" | "to">,
): TransitionEntry {
  return {
    check: test("tests/auth/login.test.ts", "login > expired token"),
    from: null,
    validity: "current",
    observedAt: 184,
    origin: { kind: "own" },
    summary: null,
    location: null,
    ...overrides,
  };
}

function delta(entries: DeltaEntry[], label: Delta["label"] = "transitions"): Delta {
  return { schemaVersion: 1, consumer, header, label, entries };
}

function failure(i: number, summary = "expected 401, received 500"): KnownFailure {
  return {
    check: test(`tests/f${i}.test.ts`, `case ${i}`),
    outcome: "fail",
    validity: "current",
    observedAt: 184,
    summary,
    fingerprint: `AssertionError: ${summary} @ src/f.ts:1:1`,
    location: { path: "src/f.ts", line: 1, column: 1 },
  };
}

const regression = entry({
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  summary: "expected 401, received 500",
  location: { path: "src/auth.ts", line: 42, column: 7 },
});
const recovery = entry({
  check: test("tests/auth/logout.test.ts", "revoked session"),
  kind: "fail-to-pass",
  from: "fail",
  to: "pass",
});

describe("formatDelta", () => {
  it("renders the header, then failures, then recoveries", () => {
    expect(formatDelta(delta([regression, recovery]))).toBe(
      [
        "SQUEAL · 2 checks changed at revision 184",
        "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full suite: not completed at revision 184, last completed at revision 170.",
        "",
        "FAIL  tests/auth/login.test.ts > login > expired token",
        "      PASS -> FAIL",
        "      expected 401, received 500",
        "      at src/auth.ts:42:7",
        "",
        "PASS  tests/auth/logout.test.ts > revoked session",
        "      FAIL -> PASS",
      ].join("\n"),
    );
  });

  it("names every kind of change", () => {
    const text = formatDelta(
      delta([
        entry({ kind: "first-seen-fail", to: "fail" }),
        entry({ kind: "first-seen-fail", from: "skip", to: "fail" }),
        entry({ kind: "fail-changed", from: "fail", to: "fail" }),
      ]),
    );
    expect(text).toContain("      first observed: FAIL\n");
    expect(text).toContain("      SKIP -> FAIL\n");
    expect(text).toContain("      FAIL -> FAIL, failure changed");
  });

  it("states provenance that is not own and current", () => {
    const text = formatDelta(
      delta([
        entry({
          kind: "pass-to-fail",
          from: "pass",
          to: "fail",
          validity: "pending",
          observedAt: 183,
          origin: { kind: "inherited", worktreeId: "wt-main", commit: "0123456789abcdef0123" },
        }),
        entry({
          kind: "fail-to-pass",
          from: "fail",
          to: "pass",
          validity: "stale",
          observedAt: 180,
        }),
      ]),
    );
    expect(text).toContain(
      "      observed at revision 183, revision 184 pending; inherited from worktree wt-main at commit 0123456789ab\n",
    );
    expect(text).toContain("      stale, observed at revision 180");
  });

  it("states a told failure that is no longer reported, after failures", () => {
    const retired: RetiredEntry = {
      check: { kind: "file", project: "", testPath: "tests/new.test.ts" },
      kind: "fail-retired",
      from: "fail",
      to: null,
      fingerprint: "SyntaxError: Unexpected token @ tests/new.test.ts:1:1",
      observedAt: 184,
    };
    const text = formatDelta(delta([retired, regression]));
    expect(text.split("\n").slice(2)).toEqual([
      "",
      "FAIL  tests/auth/login.test.ts > login > expired token",
      "      PASS -> FAIL",
      "      expected 401, received 500",
      "      at src/auth.ts:42:7",
      "",
      "RESOLVED  tests/new.test.ts (file-level)",
      "      FAIL -> no longer reported by the runner",
    ]);
  });

  it("renders the project and file-level checks", () => {
    const text = formatDelta(
      delta([
        entry({
          check: { kind: "file", project: "web", testPath: "tests/a.test.ts" },
          kind: "first-seen-fail",
          to: "fail",
        }),
      ]),
    );
    expect(text).toContain("FAIL  [web] tests/a.test.ts (file-level)\n");
  });

  it("groups checks that became unknown into one line per reason", () => {
    const unknown = (path: string, name: string, from: "pass" | "fail") =>
      entry({
        check: test(path, name),
        kind: "to-unknown",
        from,
        to: "unknown",
        validity: "unknown",
        summary: "runner crashed: worker exited",
      });
    const text = formatDelta(
      delta([
        unknown("tests/a.test.ts", "one", "pass"),
        unknown("tests/a.test.ts", "two", "pass"),
        unknown("tests/b.test.ts", "three", "fail"),
      ]),
    );
    expect(text).toContain(
      [
        "UNKNOWN  3 checks in 2 test files",
        "      PASS -> UNKNOWN (2), FAIL -> UNKNOWN (1)",
        "      runner crashed: worker exited",
        "      tests/a.test.ts, tests/b.test.ts",
      ].join("\n"),
    );
    expect(text.split("\n")[0]).toBe("SQUEAL · 3 checks changed at revision 184");
  });

  it("labels baseline findings", () => {
    const finding = entry({ kind: "first-seen-fail", to: "fail", baseline: true });
    expect(formatDelta(delta([finding], "baseline")).split("\n")[0]).toBe(
      "SQUEAL · baseline: 1 failing check found at revision 184",
    );
    const mixed = formatDelta(delta([regression, finding]));
    expect(mixed).toContain("      baseline finding, first observed: FAIL");
  });

  it("states the full-suite result", () => {
    const at = (fullSuite: StatusHeader["fullSuite"]) =>
      formatDelta({ ...delta([regression]), header: { ...header, fullSuite } }).split("\n")[1];
    expect(at({ atCurrentRevision: true, lastCompletedRevision: 184 })).toContain(
      "Full suite: completed at revision 184.",
    );
    expect(at({ atCurrentRevision: false, lastCompletedRevision: null })).toContain(
      "Full suite: not completed at any revision.",
    );
  });

  it("states test files without checks by class, only when there are any", () => {
    const line = (testFilesWithoutChecks: StatusHeader["testFilesWithoutChecks"]) =>
      formatDelta({ ...delta([regression]), header: { ...header, testFilesWithoutChecks } }).split(
        "\n",
      )[1];
    expect(line({ pending: 0, unknown: 0 })).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full suite: not completed at revision 184, last completed at revision 170.",
    );
    expect(line({ pending: 2, unknown: 1 })).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Test files without checks: 2 pending, 1 unknown. Full suite: not completed at revision 184, last completed at revision 170.",
    );
  });

  it(`caps the message at ${MESSAGE_CAP_CHARS} characters and counts what is left out`, () => {
    const entries = Array.from({ length: 2_000 }, (_, i) =>
      entry({
        check: test(`tests/f${i}.test.ts`, `case ${i}`),
        kind: "pass-to-fail",
        from: "pass",
        to: "fail",
        summary: "x".repeat(300),
        location: { path: "src/f.ts", line: i, column: 1 },
      }),
    );
    entries.push(recovery);
    const text = formatDelta(delta(entries));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    const shown = text.split("\n").filter((l) => l.startsWith("FAIL  ")).length;
    expect(shown).toBeGreaterThan(10);
    const last = text.split("\n").at(-1);
    expect(last).toBe(
      `Not shown: ${2_001 - shown} more changed checks (${2_000 - shown} FAIL, 1 PASS). \`squeal status\` lists every known failure.`,
    );
  });

  it("caps a single oversized check name", () => {
    const huge = entry({
      check: test("tests/a.test.ts", "n".repeat(50_000)),
      kind: "first-seen-fail",
      to: "fail",
      summary: "s".repeat(50_000),
    });
    expect(formatDelta(delta([huge])).length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
  });
});

describe("formatRegistration", () => {
  const registration = (knownFailures: KnownFailure[]): Registration => ({
    schemaVersion: 1,
    consumer,
    header,
    knownFailures,
  });

  it("renders the header and every known failure", () => {
    expect(formatRegistration(registration([failure(1)]))).toBe(
      [
        "SQUEAL · registered at revision 184",
        "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full suite: not completed at revision 184, last completed at revision 170.",
        "Known failures: 1",
        "",
        "FAIL  tests/f1.test.ts > case 1",
        "      expected 401, received 500",
        "      at src/f.ts:1:1",
      ].join("\n"),
    );
  });

  it("says no known failures, never that everything passes", () => {
    const text = formatRegistration(registration([]));
    expect(text.split("\n").at(-1)).toBe("Known failures: 0");
    expect(text).not.toMatch(/all .*pass|everything/i);
  });

  it(`caps the message at ${MESSAGE_CAP_CHARS} characters`, () => {
    const many = Array.from({ length: 2_000 }, (_, i) => failure(i, "y".repeat(300)));
    const text = formatRegistration(registration(many));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    const shown = text.split("\n").filter((l) => l.startsWith("FAIL  ")).length;
    expect(text.split("\n").at(-1)).toBe(
      `Not shown: ${2_000 - shown} more known failures. \`squeal status\` lists every known failure.`,
    );
  });
});

describe("wording", () => {
  /** Verbs a sentence would start with if it told the agent what to do. */
  const IMPERATIVE =
    /^(please|run|fix|check|look|see|use|try|make|do|don't|investigate|review|consider|ensure|update|rerun|re-run|go|open|read|stop|wait|keep|note|remember)\b/i;

  const entries = [
    regression,
    recovery,
    entry({ kind: "first-seen-fail", to: "fail", baseline: true }),
    entry({ kind: "fail-changed", from: "fail", to: "fail", summary: "boom" }),
    entry({ kind: "to-unknown", from: "pass", to: "unknown", summary: "runner timed out" }),
    entry({
      kind: "pass-to-fail",
      from: "pass",
      to: "fail",
      validity: "stale",
      observedAt: 100,
      origin: { kind: "inherited", worktreeId: "wt-main", commit: null },
    }),
  ];
  const many = Array.from({ length: 500 }, (_, i) =>
    entry({ kind: "pass-to-fail", from: "pass", to: "fail", summary: `${i}`.repeat(100) }),
  );
  const failures = Array.from({ length: 500 }, (_, i) => failure(i, "z".repeat(200)));
  const messages = [
    formatDelta(delta(entries)),
    formatDelta(
      delta([entry({ kind: "first-seen-fail", to: "fail", baseline: true })], "baseline"),
    ),
    formatDelta(delta(many)),
    formatRegistration({ schemaVersion: 1, consumer, header, knownFailures: [] }),
    formatRegistration({ schemaVersion: 1, consumer, header, knownFailures: failures }),
  ];
  // Summaries are runner text, quoted as is; only Squeal's own wording is checked.
  const quoted = new Set(
    [...entries, ...many, ...failures].flatMap((e) => (e.summary === null ? [] : [e.summary])),
  );

  it("contains no imperative sentences", () => {
    let checked = 0;
    for (const message of messages) {
      for (const line of message.split("\n")) {
        if (quoted.has(line.trim())) continue;
        for (const sentence of line.split(/(?<=[.;:,])\s+/)) {
          const words = sentence.trim().replace(/^(FAIL|PASS|UNKNOWN|SQUEAL ·)\s+/, "");
          expect(words, sentence).not.toMatch(IMPERATIVE);
          expect(words, sentence).not.toMatch(/\b(you|should|must|please)\b/i);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
