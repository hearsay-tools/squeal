import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import type {
  Delta,
  SlowTierState,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

/*
 * Task 001-407, decided by the human: a change delivery sends the news. It
 * drops the changed paths, the four-state split and the Inherited sentence
 * (only non-zero actionable counts stay), the full-suite checkpoint sentence,
 * and the slow-tier line unless the slow tier's state changed. The title,
 * daemon liveness, install notes, edit lines and FAIL/PASS blocks stay;
 * registration, Stop and status keep the full block.
 */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const slowTier: SlowTierState = {
  testFiles: 2,
  current: 2,
  pending: 0,
  notRun: 0,
  currentAt: 180,
  activity: null,
};
const SLOW_LINE =
  "Slow tier: 2 test files; 2 current at revision 180. Squeal runs them after the fast tests.";

const header: StatusHeader = {
  revision: 184,
  counts: { current: 47, pending: 3, stale: 1, unknown: 0 },
  fileLevelCounts: { current: 4, pending: 1, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: 170 },
  changedPaths: ["src/auth.ts", "src/parse.ts"],
  inheritedCount: 30,
  slowTier,
};

const regression: TransitionEntry = {
  check: { kind: "test", project: "", testPath: "tests/auth.test.ts", fullName: "login" },
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  validity: "current",
  observedAt: 184,
  origin: { kind: "own" },
  summary: "expected 401, received 500",
  location: { path: "src/auth.ts", line: 42, column: 7 },
};

function delta(h: StatusHeader = header, extra: Partial<Delta> = {}): Delta {
  return {
    schemaVersion: 1,
    consumer,
    header: h,
    label: "transitions",
    entries: [regression],
    ...extra,
  };
}

const lines = (text: string) => text.split("\n");
const headerLine = (h: StatusHeader, extra: Partial<Delta> = {}) =>
  lines(formatDelta(delta(h, extra)))[1];

describe("a change delivery's header sends the news (task 001-407)", () => {
  it("is the revision and the non-zero actionable counts, each split into its parts", () => {
    expect(lines(formatDelta(delta()))).toEqual([
      "SQUEAL · 1 check changed (1 test) at revision 184",
      "Revision 184: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test).",
      "",
      "FAIL  tests/auth.test.ts > login",
      "      PASS -> FAIL, seen by Squeal's run at revision 184",
      "      expected 401, received 500",
      "      at src/auth.ts:42:7",
      "",
      "Full output: squeal why 'tests/auth.test.ts > login'",
    ]);
  });

  it("drops the changed paths", () => {
    expect(headerLine(header)).not.toContain("changed");
    expect(headerLine(header)).not.toContain("src/parse.ts");
  });

  it("drops the current count and the zero counts", () => {
    expect(headerLine(header)).not.toMatch(/current|unknown|\b0 /);
  });

  it("drops the Inherited sentence", () => {
    expect(headerLine(header)).not.toContain("Inherited");
  });

  it("drops the full-suite checkpoint sentence", () => {
    const completed = {
      ...header,
      fullSuite: { atCurrentRevision: true, lastCompletedRevision: 184 },
    };
    expect(headerLine(header)).not.toContain("checkpoint");
    expect(headerLine(completed)).not.toContain("checkpoint");
  });

  it("says nothing is pending, stale or unknown when all is current", () => {
    const counts = { current: 50, pending: 0, stale: 0, unknown: 0 };
    expect(headerLine({ ...header, counts, fileLevelCounts: { ...counts, current: 4 } })).toBe(
      "Revision 184: no check pending, stale or unknown.",
    );
  });

  // Row 011-205: "no check pending, stale or unknown" never stands beside test files without checks.
  it("names the test files without checks alone when no check is pending, stale or unknown", () => {
    const counts = { current: 50, pending: 0, stale: 0, unknown: 0 };
    const fileLevelCounts = { ...counts, current: 4 };
    const h = { ...header, counts, fileLevelCounts };
    expect(headerLine({ ...h, testFilesWithoutChecks: { pending: 1, unknown: 97 } })).toBe(
      "Revision 184: test files without checks: 1 pending, 97 unknown.",
    );
    expect(headerLine({ ...h, testFilesWithoutChecks: { pending: 0, unknown: 97 } })).toBe(
      "Revision 184: test files without checks: 97 unknown.",
    );
  });

  it("says no check is pending, stale or unknown only when no test file is without checks", () => {
    const zero = { current: 50, pending: 0, stale: 0, unknown: 0 };
    for (const counts of [
      zero,
      { ...zero, pending: 1 },
      { ...zero, stale: 1 },
      { ...zero, unknown: 1 },
    ])
      for (const [pending, unknown] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [2, 3],
      ] as const)
        for (const extra of [{}, { countsOwed: { lookupOnly: true } }])
          for (const form of ["news", "full"] as const) {
            const h = {
              ...header,
              counts,
              fileLevelCounts: undefined,
              testFilesWithoutChecks: { pending, unknown },
            };
            const said = formatDelta(delta(h, extra), "squeal", 10_000, form).includes(
              "no check pending, stale or unknown",
            );
            const none = counts.pending + counts.stale + counts.unknown + pending + unknown === 0;
            expect(said, JSON.stringify({ counts, pending, unknown, extra, form })).toBe(
              none && form === "news" && !("countsOwed" in extra),
            );
          }
  });

  it("keeps the test files without checks, only their non-zero classes", () => {
    const h = { ...header, testFilesWithoutChecks: { pending: 4, unknown: 0 } };
    expect(headerLine(h)).toBe(
      "Revision 184: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test). Test files without checks: 4 pending.",
    );
  });

  it("keeps the revision's commit", () => {
    const commit = { head: "0123456789abcdef", sinceHead: 2, dirty: true };
    expect(headerLine({ ...header, commit })).toMatch(/^Revision 184 · 01234567 \+ 2, dirty: /);
  });

  it("keeps the unlisted and the runner-part sentences, which say the counts are not complete", () => {
    expect(headerLine({ ...header, testFilesListed: false })).toContain(
      " The daemon has not listed this worktree's test files yet; these counts are not complete.",
    );
    expect(headerLine({ ...header, runnerPartPending: true })).toContain(
      " is pending; test files it adds are not counted yet.",
    );
  });

  it("keeps daemon liveness", () => {
    const daemon = { state: "down" as const, since: Date.UTC(2026, 9, 4, 14, 2, 0) };
    expect(headerLine({ ...header, daemon })).toBe(
      "Revision 184: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test). " +
        "No daemon has validated since 2026-10-04T14:02:00.000Z; results are as of revision 184.",
    );
  });

  it("keeps the install notes", () => {
    const counts = "Revision 184: 3 pending (2 tests, 1 test file loaded), 1 stale (1 test).";
    expect(headerLine({ ...header, installedLockfile: "package-lock.json" })).toBe(
      `${counts} These results follow a dependency install (package-lock.json changed).`,
    );
    expect(headerLine({ ...header, dependenciesInstalled: false })).toBe(
      `${counts} No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.`,
    );
    const daemon = { state: "alive" as const, lastHeartbeatAt: 1 };
    const waiting = { ...header, daemon, awaitingInstall: true };
    expect(headerLine(waiting)).toContain(
      `${counts} No dependencies are installed in this worktree`,
    );
  });

  it("keeps the edit lines after the header", () => {
    const text = lines(formatDelta(delta(header, { sawEdit: { queued: 2 } })));
    expect(text[2]).toBe(
      "Squeal saw your edit and queued 2 test files; results arrive with later tool calls, and passing ones stay silent.",
    );
  });

  it("carries the slow-tier line only when the slow tier's state changed", () => {
    expect(formatDelta(delta())).not.toContain("Slow tier:");
    expect(lines(formatDelta(delta(header, { slowTierChanged: true })))[2]).toBe(SLOW_LINE);
  });
});

describe("registration, Stop and status keep the full block (task 001-407)", () => {
  const FULL =
    "Revision 184 (changed src/auth.ts, src/parse.ts): 47 current (43 tests, 4 test files loaded), " +
    "3 pending (2 tests, 1 test file loaded), 1 stale (1 test), 0 unknown. " +
    "Inherited: 30 of 47 current. " +
    "Full-suite checkpoint: none completed since revision 170 (the counts are for revision 184; `squeal run --all` requests one).";

  it("Stop's delta", () => {
    expect(lines(formatDelta(delta(), "squeal", 10_000, "full")).slice(1, 3)).toEqual([
      FULL,
      SLOW_LINE,
    ]);
  });

  it("the registration", () => {
    const text = formatRegistration({ schemaVersion: 1, consumer, header, knownFailures: [] });
    expect(lines(text).slice(1, 3)).toEqual([FULL, SLOW_LINE]);
  });
});
