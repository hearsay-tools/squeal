import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { Delta, TransitionEntry } from "../../src/core/types/delivery.js";
import type { SlowTierState, StatusHeader } from "../../src/core/types/status.js";

/*
 * Task 001-407, decided by the human: a change delivery sends the news. It
 * drops the four-state split and the Inherited sentence (only non-zero
 * actionable counts stay), the full-suite checkpoint sentence, and the
 * slow-tier line unless the slow tier's state changed. The title, daemon
 * liveness, install notes, edit lines and FAIL/PASS blocks stay. Row
 * 005-94: the registration and Stop leave the counts to status too, and no
 * hook names the commit. Row 011-262 (gh-105):
 * the changed paths stay too, as the full block names them. Row 005-93 (c):
 * the counts are the consumer's own, the test files its edits affect, in
 * place of the worktree's queue; with no edit since its count began, none.
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

/** Row 005-93 (c): 3 of the 4 test files the consumer's edits affect have no result yet. */
const OWN = { ownEdits: { files: 4, owed: 3 } };
const COUNT = "3 of the 4 test files your edits affect have not run.";

function delta(h: StatusHeader = header, extra: Partial<Delta> = OWN): Delta {
  return {
    schemaVersion: 1,
    consumer,
    header: h,
    label: "transitions",
    entries: [regression],
    ...extra,
  };
}

/** The news header's start: the revision and the paths it changed (row 011-262). */
const REVISION = "Revision 184 (changed src/auth.ts, src/parse.ts):";

const lines = (text: string) => text.split("\n");
const headerLine = (h: StatusHeader, extra: Partial<Delta> = OWN) =>
  lines(formatDelta(delta(h, extra)))[1];

describe("a change delivery's header sends the news (task 001-407)", () => {
  it("is the revision and the consumer's own count", () => {
    expect(lines(formatDelta(delta()))).toEqual([
      "SQUEAL · 1 check changed (1 test) at revision 184",
      `${REVISION} ${COUNT}`,
      "",
      "FAIL  tests/auth.test.ts > login",
      "      PASS -> FAIL, seen by Squeal's run at revision 184",
      "      expected 401, received 500",
      "      at src/auth.ts:42:7",
      "",
      "Full output: squeal why 'tests/auth.test.ts > login'",
    ]);
  });

  // Row 011-262 (gh-105): the incident's news line named no path, so nothing said why tests re-ran.
  it("names up to three changed paths and counts the rest, as the full form does", () => {
    const named = (changedPaths: string[]) =>
      headerLine({ ...header, changedPaths })?.split(":")[0];
    expect(named(["src/a.ts"])).toBe("Revision 184 (changed src/a.ts)");
    expect(named(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"])).toBe(
      "Revision 184 (changed src/a.ts, src/b.ts, src/c.ts and 2 more)",
    );
    expect(named([])).toBe("Revision 184");
    const { changedPaths: _, ...unnamed } = header;
    expect(headerLine(unnamed)).toBe(`Revision 184: ${COUNT}`);
  });

  it("marks each named path git ignores, in the news and the full form", () => {
    const ignored = ".ai/qa/test-env.json";
    const changedPaths = ["src/a.ts", ignored, "src/b.ts", ".ai/qa/build/out.txt"];
    const h = { ...header, changedPaths, ignoredPaths: [ignored, ".ai/qa/build/out.txt"] };
    const named = `Revision 184 (changed src/a.ts, git-ignored ${ignored}, src/b.ts and 1 more)`;
    expect(headerLine(h)).toBe(`${named}: ${COUNT}`);
    const full = lines(formatDelta(delta(h), "squeal", 10_000, "full"))[1];
    expect(full).toBe(`${named}.`);
  });

  it("drops the worktree's counts: current, pending, stale, unknown and the test files without checks", () => {
    const h = { ...header, testFilesWithoutChecks: { pending: 4, unknown: 97 } };
    expect(headerLine(h)).toBe(`${REVISION} ${COUNT}`);
    expect(headerLine(h)).not.toMatch(/current|unknown|pending|stale|without checks/);
  });

  it("says when every test file the consumer's edits affect has run", () => {
    expect(headerLine(header, { ownEdits: { files: 9, owed: 0 } })).toBe(
      `${REVISION} the 9 test files your edits affect have all run.`,
    );
    expect(headerLine(header, { ownEdits: { files: 1, owed: 0 } })).toBe(
      `${REVISION} the 1 test file your edits affect has run.`,
    );
    expect(headerLine(header, { ownEdits: { files: 1, owed: 1 } })).toBe(
      `${REVISION} the 1 test file your edits affect has not run.`,
    );
    expect(headerLine(header, { ownEdits: { files: 5, owed: 1 } })).toBe(
      `${REVISION} 1 of the 5 test files your edits affect has not run.`,
    );
    // Review 0.1.530 B4: a file that ran with no result is said, never read as passed.
    expect(headerLine(header, { ownEdits: { files: 9, owed: 0, unknown: 2 } })).toBe(
      `${REVISION} the 9 test files your edits affect have all run; 2 with no result (unknown).`,
    );
  });

  it("gives a consumer with no edit since its count began no count: it ends after the changed paths", () => {
    expect(headerLine(header, {})).toBe("Revision 184 (changed src/auth.ts, src/parse.ts).");
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

  it("says how far the first results reach once, when the consumer is owed them (rows 011-205, 005-94)", () => {
    const h = {
      ...header,
      testFilesWithoutChecks: { pending: 1, unknown: 97 },
      testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 97 },
    };
    expect(headerLine(h, { ...OWN, countsOwed: { lookupOnly: true } })).toBe(
      `${REVISION} 5 of 103 test files are current (run on the files as they are now), and \`squeal status\` counts the rest.`,
    );
  });

  it("names no commit: `squeal status` does (row 005-94)", () => {
    const commit = { head: "0123456789abcdef", sinceHead: 2, dirty: true };
    expect(headerLine({ ...header, commit })).toBe(`${REVISION} ${COUNT}`);
  });

  it("keeps the unlisted and the runner-part sentences, with or without owed files", () => {
    // Row 005-90: unlisted, the sentence replaces the counts.
    expect(headerLine({ ...header, testFilesListed: false })).toBe(
      "Revision 184 (changed src/auth.ts, src/parse.ts): Squeal is still starting in this worktree and has no results yet. " +
        "`squeal status --wait 60000 <path>...` waits for the files you change.",
    );
    // Row 011-311: a header with no runners named says "the test runner".
    expect(headerLine({ ...header, runnerPartPending: true }, {})).toContain(
      " The test runner has not yet listed the test files of revision 184, so new test files are not counted.",
    );
    expect(
      headerLine(
        { ...header, runnerPartPending: true, listingRunners: ["Vitest", "node:test"] },
        { ownEdits: { files: 2, owed: 0 } },
      ),
    ).toContain(
      " Vitest and node:test have not yet listed the test files of revision 184, so new test files are not counted.",
    );
    // Row 005-93 part 1: no late message says them yet, so the news header keeps them.
    expect(headerLine({ ...header, runnerPartPending: true })).toBe(
      `${REVISION} ${COUNT} The test runner has not yet listed the test files of revision 184, so new test files are not counted.`,
    );
  });

  it("keeps daemon liveness", () => {
    const daemon = { state: "down" as const, since: Date.UTC(2026, 9, 4, 14, 2, 0) };
    expect(headerLine({ ...header, daemon })).toBe(
      `${REVISION} ${COUNT} ` +
        "No daemon has validated since 14:02:00 UTC; results are as of revision 184.",
    );
  });

  it("keeps the install notes", () => {
    const counts = `${REVISION} ${COUNT}`;
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
      "Squeal saw your edit and queued 2 test files; results arrive with later tool calls, and passes stay silent unless they follow a failure.",
    );
  });

  it("carries the slow-tier line only when the slow tier's state changed", () => {
    expect(formatDelta(delta())).not.toContain("Slow tier:");
    expect(lines(formatDelta(delta(header, { slowTierChanged: true })))[2]).toBe(SLOW_LINE);
  });
});

describe("registration and Stop keep the changed paths and the slow-tier line (task 001-407, row 005-94)", () => {
  const FULL = "Revision 184 (changed src/auth.ts, src/parse.ts).";

  it("Stop's delta", () => {
    expect(lines(formatDelta(delta(), "squeal", 10_000, "full")).slice(1, 3)).toEqual([
      FULL,
      SLOW_LINE,
    ]);
  });

  it("the registration", () => {
    const text = formatRegistration({ schemaVersion: 1, consumer, header, knownFailures: [] });
    expect(lines(text).slice(1, 4)).toEqual([FULL, "Known failures: 0", SLOW_LINE]);
  });
});
