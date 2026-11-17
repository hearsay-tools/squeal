import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { Delta, Registration } from "../../src/core/types/delivery.js";
import type { KnownFailure, StatusHeader } from "../../src/core/types/status.js";

/*
 * Row 005-90: while the daemon has not listed the worktree's test files, the
 * registration, the news header and `squeal status` print no zero counts and
 * no known-failure count; they say that Squeal has no results yet, and the
 * wait that gives them. Row 005-94 (texts.md 3): no sentence that results are as
 * of a revision, since none exists; with no daemon, one sentence says both.
 */

const NO_RESULTS =
  "Squeal is still starting in this worktree and has no results yet. " +
  "`squeal status --wait 60000 <path>...` waits for the files you change.";

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const fresh: StatusHeader = {
  revision: 0,
  counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  testFileCounts: { current: 0, pending: 0, stale: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  testFilesListed: false,
  daemon: { state: "down", since: null, startingSince: 1 },
};

const registration = (header: StatusHeader, knownFailures: KnownFailure[] = []): Registration => ({
  schemaVersion: 1,
  consumer,
  header,
  knownFailures,
});

const delta = (header: StatusHeader): Delta => ({
  schemaVersion: 1,
  consumer,
  header,
  label: "transitions",
  entries: [],
});

describe("a worktree with no listing (row 005-90)", () => {
  it("registers with the no-results sentence, and no starting daemon's results revision", () => {
    expect(formatRegistration(registration(fresh))).toBe(
      ["SQUEAL · registered at revision 0", `Revision 0: ${NO_RESULTS}`].join("\n"),
    );
  });

  it("says no daemon runs in the same sentence, and keeps the stopped sentence after it", () => {
    const none = { ...fresh, daemon: { state: "down" as const, since: null } };
    expect(formatRegistration(registration(none)).split("\n")[1]).toBe(
      "Revision 0: Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one.",
    );
    const stopped = {
      ...fresh,
      daemon: { state: "down" as const, since: 5, stopped: true as const },
    };
    expect(formatRegistration(registration(stopped)).split("\n")[1]).toContain(
      `Revision 0: ${NO_RESULTS} The daemon is stopped by request`,
    );
  });

  it("names the CLI the harness gives", () => {
    const text = formatRegistration(registration(fresh), undefined, "node /p/squeal.mjs");
    expect(text).toContain("`node /p/squeal.mjs status --wait 60000 <path>...` waits");
  });

  it("still counts a known failure the store holds", () => {
    const failure: KnownFailure = {
      check: { kind: "test", project: "", testPath: "a.test.ts", fullName: "adds" },
      outcome: "fail",
      validity: "current",
      observedAt: 0,
      summary: "expected 3",
      fingerprint: "x",
      location: null,
    };
    const lines = formatRegistration(registration(fresh, [failure])).split("\n");
    expect(lines[1]).toContain(NO_RESULTS);
    // Row 005-94: the line above says Squeal has no results yet, so the count stands alone.
    expect(lines[2]).toBe("Known failures: 1 (1 test)");
  });

  it("sends the same sentence in a news header", () => {
    const header = { ...fresh, revision: 2, changedPaths: ["src/a.ts"] };
    expect(formatDelta(delta(header)).split("\n")[1]).toBe(
      `Revision 2 (changed src/a.ts): ${NO_RESULTS}`,
    );
  });

  it("says a listed worktree's known failures and test files (row 005-94)", () => {
    const listed = { ...fresh, testFilesListed: true };
    const text = formatRegistration(registration(listed));
    expect(text).not.toContain(NO_RESULTS);
    expect(text).toContain("Known failures: 0; the daemon listed no test files.");
  });
});
