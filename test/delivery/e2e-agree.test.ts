import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { expectAgrees, headerRevision, quietPoint } from "../e2e/agree.js";
import { settled } from "../evals/status-snapshot.js";

// Review 0.1.318 N1: the e2e agreement helper reads each header form the product prints. Row
// 005-94: the registration, Stop and the first results in a worktree count current test files,
// and no hook names the checkpoint or the commit.

const completed: StatusSnapshot = {
  ...settled,
  fullSuite: { atCurrentRevision: true, lastCompletedRevision: settled.revision },
};
const full = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const news = (s: StatusSnapshot) => formatDelta({ header: s, entries: [] } as never);
/** Row 005-93 (c): news to a consumer whose edits affect 2 test files, all run. */
const ownNews = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], ownEdits: { files: 2, owed: 0 } } as never);
const owedNews = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], countsOwed: { lookupOnly: false } } as never);

describe("e2e agreement: the header forms (rows 011-205, 005-93, 005-94)", () => {
  it("accepts the first results in a worktree, which count current test files", () => {
    const text = owedNews(completed);
    expect(text).toContain(
      `Revision ${settled.revision}: all 6 test files are current (run on the files as they are now).`,
    );
    expect(() => expectAgrees(text, completed)).not.toThrow();
  });

  it("accepts ordinary news and the registration, and rejects a file owed at a quiet point", () => {
    expect(() => expectAgrees(news(completed), completed)).not.toThrow();
    expect(ownNews(completed)).toContain("the 2 test files your edits affect have all run.");
    expect(() => expectAgrees(ownNews(completed), completed)).not.toThrow();
    const owing = formatDelta({
      header: completed,
      entries: [],
      ownEdits: { files: 2, owed: 1 },
    } as never);
    expect(() => expectAgrees(owing, completed)).toThrow();
    expect(full(completed)).not.toContain("Full-suite checkpoint");
    expect(() => expectAgrees(full(completed), completed)).not.toThrow();
  });

  // Review 0.1.537 S1, the sequence the probe sampled (worktrees.test.ts, both plugins): the edit
  // settled on its check counts while the new failure's confirmation run kept its test file
  // pending; a hook at that moment counted 1 of 2 current, the status read after the run 2 of 2.
  it("waits for a test file's open run, then compares the counts strictly", () => {
    const open = {
      ...settled,
      testFileCounts: { current: 1, pending: 1, stale: 0, unknown: 0 },
      testFilesByPhase: { running: 1, queued: 0 },
    } as StatusSnapshot;
    const stable = { ...settled, testFileCounts: { current: 2, pending: 0, stale: 0, unknown: 0 } };
    expect(open.counts.pending).toBe(0);
    expect(quietPoint(open)).toBe(false);
    expect(quietPoint(stable as StatusSnapshot)).toBe(true);
    expect(() => expectAgrees(full(open), stable as StatusSnapshot)).toThrow();
    expect(() =>
      expectAgrees(full(stable as StatusSnapshot), stable as StatusSnapshot),
    ).not.toThrow();
    // A registration claiming more current files than status still fails.
    expect(() => expectAgrees(full(stable as StatusSnapshot), open)).toThrow();
    // With `fastOnly`, a slow file's open run is no reason to wait (spec 004 D2).
    const slowOpen = {
      ...open,
      slowPending: { testFiles: 1, checks: 0, testFilesWithoutChecks: 0 },
    } as StatusSnapshot;
    expect(quietPoint(slowOpen, true)).toBe(true);
    expect(quietPoint(slowOpen)).toBe(false);
  });

  it("rejects a header that names its commit or the checkpoint", () => {
    const old =
      "SQUEAL · registered at revision 3\nRevision 3 · 0123abcd + 2, dirty (changed a.ts).";
    expect(() => expectAgrees(old, settled)).toThrow();
    const checkpoint = `${full(settled)}\nFull-suite checkpoint: completed at revision 3.`;
    expect(() => expectAgrees(checkpoint, settled)).toThrow();
  });
});

// Row 011-262: the news form names the changed paths after the revision.
describe("e2e agreement: news that names the changed paths", () => {
  const changed = { ...settled, changedPaths: ["src/a.ts", ".ai/qa/env.json"] };
  const ignored = { ...changed, ignoredPaths: [".ai/qa/env.json"] };
  const committed = {
    ...ignored,
    commit: { head: "0123abcd".repeat(5), sinceHead: 2, dirty: true },
  };

  it("reads the revision past the paths clause", () => {
    for (const s of [changed, ignored, committed]) {
      const text = news(s);
      expect(text).toContain(" (changed src/a.ts, ");
      expect(() => expectAgrees(text, s)).not.toThrow();
      expect(headerRevision(text)).toBe(settled.revision);
    }
  });

  // Review 0.1.379 S2: a route group's `)` is not the clause's end.
  it("reads past a path that holds a closing parenthesis, in either form", () => {
    const routed = { ...settled, changedPaths: ["src/app/(auth)/page.tsx"] };
    for (const s of [routed, { ...routed, commit: committed.commit }])
      for (const text of [news(s), ownNews(s), full(s)]) {
        expect(text).toMatch(/ \(changed src\/app\/\(auth\)\/page\.tsx\)[:.]/);
        expect(() => expectAgrees(text, s)).not.toThrow();
        expect(headerRevision(text)).toBe(settled.revision);
      }
  });

  it("reads the revision from the title when the registration has no revision line", () => {
    expect(full(settled).split("\n")[1]).toMatch(/^Known failures: 0; /);
    expect(headerRevision(full(settled))).toBe(settled.revision);
  });
});
