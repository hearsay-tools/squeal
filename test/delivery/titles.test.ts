import { describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/format.js";
import type { Delta } from "../../src/core/types/delivery.js";
import type { GroupTierState, StatusHeader } from "../../src/core/types/status.js";

/*
 * Row 005-91 (c): 559 messages were titled only `SQUEAL · revision N` while they carried the
 * first-edit line, the owed counts, a group line or a commit line. Each now gives the title
 * its words.
 */

const consumer = { worktreeId: "wt-a", sessionId: "s1", agentId: "main" };

const header: StatusHeader = {
  revision: 5,
  counts: { current: 10, pending: 2, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  testFilesListed: true,
};

const browser = (pending: number, notRun = 0): GroupTierState => ({
  name: "browser",
  at: "manual",
  after: [],
  quietMs: 0,
  testFiles: 4,
  current: 4 - pending - notRun,
  pending,
  notRun,
  currentAt: 3,
  activity: null,
});

const titleOf = (parts: Partial<Delta>, h: StatusHeader = header): string =>
  formatDelta({
    schemaVersion: 1,
    consumer,
    header: h,
    label: "transitions",
    entries: [],
    ...parts,
  }).split("\n")[0] ?? "";

describe("a delivery with no changed check is titled by its content (row 005-91 c)", () => {
  it("names the first edit's queued test files", () => {
    expect(titleOf({ sawEdit: { queued: 2 } })).toBe(
      "SQUEAL · your edit queued 2 test files at revision 5",
    );
    expect(titleOf({ sawEdit: { queued: 1 } }, { ...header, noTestsAtEdit: true })).toBe(
      "SQUEAL · your edit re-keyed 1 test file at revision 5",
    );
  });

  it("names the edits' test files once they are settled", () => {
    const settled = { since: 3, files: 2, unknown: 0 };
    expect(titleOf({ editsSettled: settled })).toBe(
      "SQUEAL · your edits' test files are current at revision 5",
    );
    expect(titleOf({ sawEdit: { queued: 2 }, editsSettled: { ...settled, unknown: 1 } })).toBe(
      "SQUEAL · your edits' test files finished at revision 5",
    );
  });

  it("names the owed counts, a group's kind and a commit", () => {
    expect(titleOf({ sawEdit: { queued: 2 }, countsOwed: { lookupOnly: false } })).toBe(
      "SQUEAL · your edit queued 2 test files; the counts after the listing at revision 5",
    );
    const groups = { ...header, groupTiers: [browser(2)] };
    expect(titleOf({ sawEdit: { queued: 2 }, groupTiersChanged: true }, groups)).toBe(
      "SQUEAL · your edit queued 2 test files; browser group waiting at revision 5",
    );
    const commitLine = { commit: "abc1234def5678", text: "Commit abc1234: 1 known failure" };
    expect(titleOf({ commitChanged: true }, { ...header, commitLine })).toBe(
      "SQUEAL · commit abc1234 at revision 5",
    );
  });

  it("is never the revision alone for any of these", () => {
    const groups = { ...header, groupTiers: [browser(0, 1)] };
    for (const parts of [
      { sawEdit: { queued: 2 } },
      { editsSettled: { since: 1, files: 1, unknown: 0 } },
      { sawEdit: { queued: 2 }, groupTiersChanged: true as const },
    ]) {
      expect(titleOf(parts, groups)).not.toBe("SQUEAL · revision 5");
    }
  });
});
