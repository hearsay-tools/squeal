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
        "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full-suite checkpoint: none completed at revision 184; last completed at revision 170.",
        "",
        "FAIL  tests/auth/login.test.ts > login > expired token",
        "      PASS -> FAIL",
        "      expected 401, received 500",
        "      at src/auth.ts:42:7",
        "",
        "PASS  tests/auth/logout.test.ts > revoked session",
        "      FAIL -> PASS",
        "",
        'Full output: squeal why "tests/auth/login.test.ts > login > expired token"',
      ].join("\n"),
    );
  });

  it("ends a FAIL report with one squeal why line, for its first failure (task 001-88)", () => {
    const second = entry({
      check: test("tests/b.test.ts", "b"),
      kind: "first-seen-fail",
      to: "fail",
    });
    const text = formatDelta(delta([recovery, regression, second]));
    expect(text.match(/squeal why/g)).toHaveLength(1);
    expect(text.split("\n").at(-1)).toBe(
      'Full output: squeal why "tests/auth/login.test.ts > login > expired token"',
    );
    expect(formatDelta(delta([recovery]))).not.toContain("squeal why");
  });

  it("quotes a name the shell would expand in single quotes", () => {
    const odd = entry({
      check: test("tests/a.test.ts", `it's "$HOME"`),
      kind: "first-seen-fail",
      to: "fail",
    });
    expect(
      formatDelta(delta([odd]))
        .split("\n")
        .at(-1),
    ).toBe(`Full output: squeal why 'tests/a.test.ts > it'\\''s "$HOME"'`);
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
      "",
      'Full output: squeal why "tests/auth/login.test.ts > login > expired token"',
    ]);
  });

  it("names an inherited result's worktree by its root when known", () => {
    const inherited = entry({
      kind: "first-seen-fail",
      to: "fail",
      origin: { kind: "inherited", worktreeId: "0123456789abcdef", commit: "0123456789abcdef0123" },
    });
    expect(formatDelta(delta([{ ...inherited, originRoot: "/repo/main" }]))).toContain(
      "      inherited from /repo/main at commit 0123456789ab",
    );
    expect(formatDelta(delta([inherited]))).toContain(
      "      inherited from worktree 0123456789abcdef at commit 0123456789ab",
    );
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

  it("states the full-suite checkpoint as a request, not a coverage state (lessons, surprise 7)", () => {
    const at = (fullSuite: StatusHeader["fullSuite"]) =>
      formatDelta({ ...delta([regression]), header: { ...header, fullSuite } }).split("\n")[1];
    expect(at({ atCurrentRevision: true, lastCompletedRevision: 184 })).toContain(
      "Full-suite checkpoint: completed at revision 184.",
    );
    expect(at({ atCurrentRevision: false, lastCompletedRevision: null })).toContain(
      "Full-suite checkpoint: none completed at any revision.",
    );
  });

  it("states test files without checks by class, only when there are any", () => {
    const line = (testFilesWithoutChecks: StatusHeader["testFilesWithoutChecks"]) =>
      formatDelta({ ...delta([regression]), header: { ...header, testFilesWithoutChecks } }).split(
        "\n",
      )[1];
    expect(line({ pending: 0, unknown: 0 })).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full-suite checkpoint: none completed at revision 184; last completed at revision 170.",
    );
    expect(line({ pending: 2, unknown: 1 })).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Test files without checks: 2 pending, 1 unknown. Full-suite checkpoint: none completed at revision 184; last completed at revision 170.",
    );
  });

  it("says when the daemon has not listed the test files yet (lessons, defect 4)", () => {
    const line = (h: StatusHeader) =>
      formatDelta({ ...delta([regression]), header: h }).split("\n")[1];
    const fresh: StatusHeader = {
      revision: 0,
      counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      testFilesListed: false,
    };
    expect(line(fresh)).toBe(
      "Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. " +
        "The daemon has not listed this worktree's test files yet; these counts are not complete. " +
        "Full-suite checkpoint: none completed at any revision.",
    );
    expect(line({ ...header, testFilesListed: true })).toBe(line(header));
  });

  it("names the files the revision changed, three and a count of the rest (task 001-85)", () => {
    const line = (changedPaths: string[]) =>
      formatDelta({ ...delta([regression]), header: { ...header, changedPaths } }).split("\n")[1];
    const counts =
      ": 47 current, 3 pending, 0 stale, 12 unknown. " +
      "Full-suite checkpoint: none completed at revision 184; last completed at revision 170.";
    expect(line(["src/auth.ts"])).toBe(`Revision 184 (changed src/auth.ts)${counts}`);
    expect(line(["a.ts", "b.ts", "c.ts"])).toBe(`Revision 184 (changed a.ts, b.ts, c.ts)${counts}`);
    expect(line(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"])).toBe(
      `Revision 184 (changed a.ts, b.ts, c.ts and 2 more)${counts}`,
    );
    expect(line([])).toBe(`Revision 184${counts}`);
    // A registration's header line is the same line.
    const registration = formatRegistration({
      schemaVersion: 1,
      consumer,
      header: { ...header, changedPaths: ["src/auth.ts"] },
      knownFailures: [],
    });
    expect(registration.split("\n")[1]).toBe(`Revision 184 (changed src/auth.ts)${counts}`);
  });

  it("counts inherited current results, only when there are any", () => {
    const line = (inheritedCount: number) =>
      formatDelta({ ...delta([regression]), header: { ...header, inheritedCount } }).split("\n")[1];
    expect(line(30)).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Inherited: 30 of 47 current. " +
        "Full-suite checkpoint: none completed at revision 184; last completed at revision 170.",
    );
    expect(line(0)).toBe(formatDelta(delta([regression])).split("\n")[1]);
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
    const [last, blank, why] = text.split("\n").slice(-3);
    expect(blank).toBe("");
    expect(why).toBe('Full output: squeal why "tests/f0.test.ts > case 0"');
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

describe("daemon liveness in the header (review wave 3, S2)", () => {
  const since = Date.UTC(2026, 9, 4, 14, 2, 0);
  const down = { ...header, daemon: { state: "down" as const, since } };

  it("says nothing while a daemon validates", () => {
    const alive = { ...header, daemon: { state: "alive" as const, lastHeartbeatAt: since } };
    expect(formatDelta({ ...delta([regression]), header: alive })).toBe(
      formatDelta(delta([regression])),
    );
  });

  it("states since when no daemon has validated and which revision the results are as of", () => {
    const text = formatRegistration({
      schemaVersion: 1,
      consumer,
      header: down,
      knownFailures: [],
    });
    expect(text.split("\n")[1]).toBe(
      "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. " +
        "Full-suite checkpoint: none completed at revision 184; last completed at revision 170. " +
        "No daemon has validated since 2026-10-04T14:02:00.000Z; results are as of revision 184.",
    );
  });

  it("states a daemon that never recorded a heartbeat as none running", () => {
    const none = { ...header, daemon: { state: "down" as const, since: null } };
    expect(formatDelta({ ...delta([regression]), header: none })).toContain(
      " No daemon is running; results are as of revision 184.",
    );
  });

  it("titles a delta that carries only a liveness change", () => {
    expect(formatDelta({ ...delta([]), header: down, liveness: down.daemon })).toBe(
      "SQUEAL · no daemon is validating at revision 184\n" +
        "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. " +
        "Full-suite checkpoint: none completed at revision 184; last completed at revision 170. " +
        "No daemon has validated since 2026-10-04T14:02:00.000Z; results are as of revision 184.",
    );
    const alive = { state: "alive" as const, lastHeartbeatAt: since };
    expect(
      formatDelta({ ...delta([]), header: { ...header, daemon: alive }, liveness: alive }),
    ).toMatch(/^SQUEAL · a daemon is validating again at revision 184\nRevision 184: /);
  });
});

describe("formatRegistration", () => {
  const registration = (knownFailures: KnownFailure[]): Registration => ({
    schemaVersion: 1,
    consumer,
    header,
    knownFailures,
  });

  it("names inherited results and unlisted test files in the registration header", () => {
    const text = formatRegistration({
      ...registration([]),
      header: { ...header, inheritedCount: 47, testFilesListed: true },
    });
    expect(text.split("\n")[1]).toContain(" Inherited: 47 of 47 current. ");
    const fresh = formatRegistration({
      ...registration([]),
      header: { ...header, testFilesListed: false },
    });
    expect(fresh).toContain("The daemon has not listed this worktree's test files yet");
  });

  it("renders the header and every known failure", () => {
    expect(formatRegistration(registration([failure(1)]))).toBe(
      [
        "SQUEAL · registered at revision 184",
        "Revision 184: 47 current, 3 pending, 0 stale, 12 unknown. Full-suite checkpoint: none completed at revision 184; last completed at revision 170.",
        "Known failures: 1",
        "",
        "FAIL  tests/f1.test.ts > case 1",
        "      expected 401, received 500",
        "      at src/f.ts:1:1",
        "",
        'Full output: squeal why "tests/f1.test.ts > case 1"',
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
    expect(text.split("\n").at(-3)).toBe(
      `Not shown: ${2_000 - shown} more known failures. \`squeal status\` lists every known failure.`,
    );
    expect(text.split("\n").at(-1)).toBe('Full output: squeal why "tests/f0.test.ts > case 0"');
  });

  it("stays under a smaller cap, which leaves room for the SessionStart primer", () => {
    const many = Array.from({ length: 40 }, (_, i) => failure(i, "y".repeat(300)));
    const text = formatRegistration(registration(many), 6_000);
    expect(text.length).toBeLessThanOrEqual(6_000);
    expect(text).toContain("Not shown: ");
    expect(text.split("\n").at(-1)).toBe('Full output: squeal why "tests/f0.test.ts > case 0"');
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
    formatDelta({
      ...delta([]),
      header: { ...header, daemon: { state: "down", since: 1 } },
      liveness: { state: "down", since: 1 },
    }),
    formatDelta({
      ...delta([regression]),
      header: { ...header, daemon: { state: "down", since: null } },
    }),
    formatDelta({
      ...delta([]),
      header: { ...header, daemon: { state: "alive", lastHeartbeatAt: 1 } },
      liveness: { state: "alive", lastHeartbeatAt: 1 },
    }),
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
