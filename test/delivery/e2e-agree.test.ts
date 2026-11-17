import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { expectAgrees, headerRevision } from "../e2e/agree.js";
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

  // Results landing between the hook and the status read add current files at one revision:
  // the hook may count fewer than status, never more, and the same files listed.
  it("rejects a registration that counts more current test files than status, or other files", () => {
    const fewer = {
      ...settled,
      testFileCounts: { current: 5, pending: 0, stale: 0, unknown: 1 },
    } as StatusSnapshot;
    expect(() => expectAgrees(full(settled), fewer)).toThrow();
    expect(() => expectAgrees(full(fewer), fewer)).not.toThrow();
    expect(() => expectAgrees(full(fewer), settled)).not.toThrow();
    const more = {
      ...settled,
      testFileCounts: { current: 6, pending: 0, stale: 0, unknown: 1 },
    } as StatusSnapshot;
    expect(() => expectAgrees(full(fewer), more)).toThrow();
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
