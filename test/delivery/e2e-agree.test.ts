import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees } from "../e2e/agree.js";
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
