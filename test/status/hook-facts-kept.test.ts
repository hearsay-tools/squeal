import { describe, expect, it } from "vitest";
import { formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import type { CommitSha } from "../../src/core/types/common.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { settled } from "../evals/status-snapshot.js";

/*
 * Row 005-94 (texts.md 1, "The changes"; status.md 2026-11-16): each fact the registration and
 * Stop no longer say stays readable on request. `squeal status` prints the worktree's counts,
 * the checkpoint, the commit, the slow tier with no slow file listed and a count in progress;
 * `squeal status --full` the inherited and imported counts and the test files without checks.
 */

const HEAD = "a8f6984d00000000000000000000000000000000" as CommitSha;
const NOW = Date.UTC(2026, 10, 17, 1, 17, 0);

const snapshot: StatusSnapshot = {
  ...settled,
  revision: 79,
  head: HEAD,
  dirty: true,
  commit: { head: HEAD, sinceHead: 3, dirty: true },
  counts: { current: 4400, pending: 0, stale: 0, unknown: 36 },
  testFilesWithoutChecks: { pending: 0, unknown: 100 },
  testFileCounts: { current: 468, pending: 0, stale: 0, unknown: 116 },
  inheritedCount: 4100,
  inherited: { count: 4100, sources: [] },
  imports: [
    {
      importId: "i1",
      source: "local export at a8f6984d",
      commit: HEAD,
      importedAt: NOW,
      currentResults: 12,
      testFiles: 3,
      currentFiles: 3,
      notCurrent: {
        sameKeyKept: 0,
        sameKeyNotAdopted: 0,
        environment: 0,
        closure: 0,
        observed: 0,
        content: 0,
        keysPending: 0,
        noKey: 0,
      },
      environmentDifferences: [],
    },
  ],
  slowTier: { testFiles: 0, current: 0, pending: 0, notRun: 0, currentAt: null, activity: null },
  code: {
    v: 1,
    threshold: 20,
    over: 0,
    sinceRegistration: 0,
    since: null,
    pending: 3,
    files: 5,
    unknown: 0,
  },
  breakdown: {
    ...settled.breakdown,
    currentByOutcome: { pass: 4400, fail: 0, skip: 0, unknown: 0 },
    testFilesWithoutChecks: 100,
  },
} as StatusSnapshot;

const hook = formatRegistration({ header: snapshot, knownFailures: [] } as never);
const status = formatStatus(snapshot, NOW);
const full = formatStatus(snapshot, NOW, "squeal", { full: true });

describe("every fact the hooks leave out stays in squeal status (row 005-94)", () => {
  it.each([
    ["the checkpoint", "Full-suite checkpoint: none completed at any revision", status],
    ["the commit", "Revision: 79 · a8f6984d + 3, dirty", status],
    ["the worktree's counts", "Affected checks: 4400 passed", status],
    ["what is not current", "; not current: 116 of 584 test files (116 unknown)", status],
    ["the slow tier at 0 slow files", "Slow tier: no slow test files listed yet", status],
    ["a count in progress", "Complexity: counting, 2 of 5 files.", status],
    ["the inherited count", "Inherited from other worktrees: 4100 current results", full],
    ["the imported count", "Imported: 3 of 3 test files current from local export", full],
    ["the test files without checks", "Test files without checks: 0 pending, 100 unknown", full],
  ])("%s", (_, fact, text) => {
    expect(text).toContain(fact);
  });

  it("while the registration says none of them", () => {
    for (const gone of [
      "Full-suite checkpoint",
      "a8f6984d",
      "4400",
      "not current:",
      "Slow tier",
      "Complexity",
      "Inherited",
      "Imported",
      "without checks",
    ]) {
      expect(hook).not.toContain(gone);
    }
  });
});
