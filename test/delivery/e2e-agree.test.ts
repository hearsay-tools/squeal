import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees, headerRevision } from "../e2e/agree.js";
import { settled } from "../evals/status-snapshot.js";

// Review 0.1.318 N1: the e2e agreement helper reads each header form the product prints, so
// a completed checkpoint beside owed news (row 011-205) is not taken for a full header.

const completed: StatusSnapshot = {
  ...settled,
  fullSuite: { atCurrentRevision: true, lastCompletedRevision: settled.revision },
};
const full = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const news = (s: StatusSnapshot) => formatDelta({ header: s, entries: [] } as never);
const owedNews = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], countsOwed: { lookupOnly: false } } as never);

describe("e2e agreement: the header forms beside a completed checkpoint", () => {
  it("accepts owed news, which has the full counts and no checkpoint sentence", () => {
    const text = owedNews(completed);
    expect(text).toContain(`Revision ${settled.revision}: 31 current, 0 pending`);
    expect(text).not.toContain("Full-suite checkpoint");
    expect(() => expectAgrees(text, completed)).not.toThrow();
  });

  it("accepts ordinary news and a full header with the checkpoint", () => {
    expect(() => expectAgrees(news(completed), completed)).not.toThrow();
    expect(full(completed)).toContain(`Full-suite checkpoint: completed at revision 3.`);
    expect(() => expectAgrees(full(completed), completed)).not.toThrow();
  });

  it("still rejects a full header whose checkpoint disagrees with status", () => {
    expect(() => expectAgrees(full(settled), completed)).toThrow();
  });
});

// Row 011-262: the news form names the changed paths after the revision and its commit.
describe("e2e agreement: news that names the changed paths", () => {
  const changed = { ...settled, changedPaths: ["src/a.ts", ".ai/qa/env.json"] };
  const ignored = { ...changed, ignoredPaths: [".ai/qa/env.json"] };
  const committed = {
    ...ignored,
    commit: { head: "0123abcd".repeat(5), sinceHead: 2, dirty: true },
  };

  it("reads the revision and the commit past the paths clause", () => {
    for (const s of [changed, ignored, committed]) {
      const text = news(s);
      expect(text).toContain(" (changed src/a.ts, ");
      expect(() => expectAgrees(text, s)).not.toThrow();
      expect(headerRevision(text)).toBe(settled.revision);
    }
  });

  // Review 0.1.379 S2: a route group's `)` is not the clause's end; the commit is still read.
  it("reads past a path that holds a closing parenthesis, in either form", () => {
    const routed = { ...settled, changedPaths: ["src/app/(auth)/page.tsx"] };
    for (const s of [routed, { ...routed, commit: committed.commit }])
      for (const text of [news(s), full(s)]) {
        expect(text).toContain(" (changed src/app/(auth)/page.tsx): ");
        expect(() => expectAgrees(text, s)).not.toThrow();
        expect(headerRevision(text)).toBe(settled.revision);
      }
    // The commit's captures stay where `expectAgrees` reads them: a wrong one disagrees.
    const wrong = { ...routed, commit: { ...committed.commit, sinceHead: 3 } };
    expect(() => expectAgrees(news({ ...routed, commit: committed.commit }), wrong)).toThrow();
  });
});
