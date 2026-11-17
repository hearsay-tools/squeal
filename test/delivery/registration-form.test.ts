import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { Delta, Registration } from "../../src/core/types/delivery.js";
import type { KnownFailure, SlowTierState, StatusHeader } from "../../src/core/types/status.js";
import { knownFailuresLine, statusText } from "../../src/harness/shared/text.js";

/*
 * Row 005-94 (the human, 2026-11-17, `tasks/005-94/texts.md` "Decided"): the registration and
 * Stop carry no worktree counts (R1, C2). The `Known failures` line comes first and says how many
 * test files are current, the word defined in place; `squeal status` counts the rest. A
 * `Revision` line only when it has something to say; no slow-tier line at 0 slow files (C5).
 */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };
const LIVE = { state: "alive", lastHeartbeatAt: 1 } as const;
const R1 =
  "Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.";

/** Texts.md's default coverage at revision 79, with every fact the hook leaves out set. */
const header: StatusHeader = {
  revision: 79,
  counts: { current: 4400, pending: 120, stale: 0, unknown: 36 },
  fileLevelCounts: { current: 468, pending: 12, stale: 0, unknown: 4 },
  testFileCounts: { current: 468, pending: 12, stale: 0, unknown: 104 },
  testFilesWithoutChecks: { pending: 0, unknown: 100 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  commit: { head: "a8f6984d00000000000000000000000000000000", sinceHead: 3, dirty: true },
  inheritedCount: 4100,
  importedCount: 12,
  testFilesListed: true,
  daemon: LIVE,
};

const registration = (h: StatusHeader, knownFailures: KnownFailure[] = []): Registration => ({
  schemaVersion: 1,
  consumer,
  header: h,
  knownFailures,
});

function failure(i: number): KnownFailure {
  return {
    check: { kind: "test", project: "", testPath: `tests/f${i}.test.ts`, fullName: `case ${i}` },
    outcome: "fail",
    validity: "current",
    observedAt: 79,
    summary: "expected 1, received 2",
    fingerprint: "x",
    location: null,
  };
}

describe("the registration's form (row 005-94, R1)", () => {
  it("says the known failures and how many test files are current, and nothing the person reads", () => {
    const text = formatRegistration(registration(header));
    expect(text).toBe(["SQUEAL · registered at revision 79", R1].join("\n"));
    for (const gone of [
      "Inherited",
      "Imported",
      "Test files without checks",
      "Full-suite checkpoint",
      "a8f6984d",
      "dirty",
      "4400 current",
    ]) {
      expect(text).not.toContain(gone);
    }
  });

  it("keeps a revision line only when it has something to say", () => {
    const changed = formatRegistration(registration({ ...header, changedPaths: ["src/a.ts"] }));
    expect(changed.split("\n").slice(1, 3)).toEqual(["Revision 79 (changed src/a.ts).", R1]);
    const down = formatRegistration(
      registration({ ...header, daemon: { state: "down", since: null } }),
    );
    expect(down.split("\n")[1]).toBe(
      "Revision 79: No daemon is running; results are as of revision 79.",
    );
    const late = formatRegistration(
      registration({
        ...header,
        daemon: { ...LIVE, late: { since: Date.UTC(2026, 10, 17, 1, 16, 30) } },
      }),
    );
    expect(late.split("\n")[1]).toMatch(/^Revision 79: Squeal has not yet read edits made after /);
  });

  it("says all test files are current only while a live daemon read every edit", () => {
    const all = { ...header, testFileCounts: { current: 484, pending: 0, stale: 0, unknown: 0 } };
    expect(formatRegistration(registration(all)).split("\n")[1]).toBe(
      "Known failures: 0; all 484 test files are current (run on the files as they are now).",
    );
    const listing = formatRegistration(registration({ ...all, runnerPartPending: true }));
    expect(listing).toContain(
      "Known failures: 0; 484 test files are current (run on the files as they are now).",
    );
  });

  it("counts the failures before the test files", () => {
    const text = formatRegistration(registration(header, [failure(1), failure(2)]));
    expect(text.split("\n")[1]).toBe(
      "Known failures: 2 (2 tests); 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.",
    );
  });

  it("puts the slow-tier line after the known failures, and none at 0 slow files (C5)", () => {
    const tier: SlowTierState = {
      testFiles: 3,
      current: 1,
      pending: 0,
      notRun: 2,
      currentAt: 75,
      activity: null,
    };
    const slow = formatRegistration(registration({ ...header, slowTier: tier }));
    expect(slow.split("\n")[1]).toBe(R1);
    expect(slow.split("\n")[2]).toMatch(/^Slow tier: 3 test files; /);
    const none = formatRegistration(
      registration({
        ...header,
        slowTier: { ...tier, testFiles: 0, current: 0, notRun: 0 },
      }),
    );
    expect(none).not.toContain("Slow tier");
  });

  it("leaves a count in progress to status: complexity and lint", () => {
    const counting = formatRegistration({
      ...registration(header),
      code: { over: 0, threshold: 20, counting: { done: 0, total: 0 } } as never,
      lint: { failing: 0, stale: 0, linting: { done: 1, total: 4 } } as never,
    });
    expect(counting).not.toContain("Complexity");
    expect(counting).not.toContain("Lint");
    const counted = formatRegistration({
      ...registration(header),
      code: { over: 74, threshold: 20 } as never,
    });
    expect(counted.split("\n").at(-1)).toBe(
      "Complexity: 74 functions over 20; squeal code lists them.",
    );
  });
});

describe("the unlisted forms (row 005-94, texts.md 3)", () => {
  const unlisted: StatusHeader = {
    ...header,
    revision: 0,
    counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
    testFileCounts: { current: 0, pending: 0, stale: 0, unknown: 0 },
    testFilesListed: false,
    daemon: { state: "down", since: null, startingSince: 1 },
  };
  const starting =
    "Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change.";

  it("says no results yet, with no revision the results are as of", () => {
    expect(formatRegistration(registration(unlisted))).toBe(
      ["SQUEAL · registered at revision 0", starting].join("\n"),
    );
    expect(statusText(unlisted, [])).toBe(["SQUEAL · status at revision 0", starting].join("\n"));
  });

  it("says no daemon is running and what starts one, in one sentence", () => {
    const none = { ...unlisted, daemon: { state: "down", since: null } } as const;
    expect(formatRegistration(registration(none)).split("\n")[1]).toBe(
      "Revision 0: Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one.",
    );
  });
});

describe("Stop's form (row 005-94, C2)", () => {
  it("takes the registration's form with no delta", () => {
    expect(statusText(header, [])).toBe(["SQUEAL · status at revision 79", R1].join("\n"));
  });

  it("ends a delta with the same known failures line, after a short header", () => {
    const delta: Delta = { schemaVersion: 1, consumer, header, label: "transitions", entries: [] };
    const text = `${formatDelta(delta, undefined, undefined, "full")}\n${knownFailuresLine([], "squeal", header)}`;
    expect(text).not.toContain("Full-suite checkpoint");
    expect(text.split("\n").at(-1)).toBe(R1);
  });

  it("says no known failures line while unlisted and none failed", () => {
    expect(knownFailuresLine([], "squeal", { ...header, testFilesListed: false })).toBe("");
    expect(knownFailuresLine([failure(1)], "squeal", { ...header, testFilesListed: false })).toBe(
      "Known failures: 1 (tests/f1.test.ts > case 1)",
    );
  });
});

describe("the owed counts (row 011-205, as row 005-94 words them)", () => {
  it("says how far the first results reach, under its own title", () => {
    const delta: Delta = {
      schemaVersion: 1,
      consumer,
      header,
      label: "transitions",
      entries: [],
      countsOwed: { lookupOnly: true },
    };
    expect(formatDelta(delta)).toBe(
      [
        "SQUEAL · first results in this worktree at revision 79",
        "Revision 79: 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.",
      ].join("\n"),
    );
  });
});
