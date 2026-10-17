import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  MAX_CANDIDATES,
  splitParents,
} from "../../.github/scripts/issue-intake-candidates.cjs";

const repo = "hearsay-tools/squeal";
const now = "2026-10-17T12:00:00Z";

function issue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels: [],
    updated_at: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

function numbers(candidates: { number: number }[]) {
  return candidates.map((candidate) => candidate.number);
}

describe("buildCandidates", () => {
  it("never offers the new issue itself", () => {
    const candidates = buildCandidates({
      issue: issue(211),
      openIssues: [issue(14), issue(211), issue(15)],
      repo,
      now,
    });
    expect(numbers(candidates)).toEqual([14, 15]);
  });

  it("offers issues closed in the last 30 days, flagged closed, after the open ones", () => {
    const candidates = buildCandidates({
      issue: issue(211),
      openIssues: [issue(14)],
      closedIssues: [
        issue(5, { closed_at: "2026-10-16T21:06:00Z" }),
        issue(4, { closed_at: "2026-09-17T12:00:00Z" }),
        issue(3, { closed_at: "2026-09-17T11:59:59Z" }),
        issue(2, { closed_at: null }),
      ],
      repo,
      now,
    });
    expect(candidates.map(({ number, open }) => ({ number, open }))).toEqual([
      { number: 14, open: true },
      { number: 5, open: false },
      { number: 4, open: false },
    ]);
  });

  it("keeps an issue listed as both open and closed once, as open", () => {
    const candidates = buildCandidates({
      issue: issue(211),
      openIssues: [issue(14)],
      closedIssues: [issue(14, { closed_at: now })],
      repo,
      now,
    });
    expect(candidates.map(({ number, open }) => ({ number, open }))).toEqual([
      { number: 14, open: true },
    ]);
  });

  it("applies the self, split-out and epic exclusions to closed issues too", () => {
    const closed = (number: number, extra = {}) => issue(number, { closed_at: now, ...extra });
    const candidates = buildCandidates({
      issue: issue(211, { body: "Split out of #5." }),
      openIssues: [],
      closedIssues: [closed(5), closed(211), closed(6, { labels: ["epic"] }), closed(7)],
      repo,
      now,
    });
    expect(numbers(candidates)).toEqual([7]);
  });

  it("keeps every split-out spelling's parent out of the candidates", () => {
    for (const body of [
      "Split out of #14.",
      "split out of hearsay-tools/squeal#14",
      "Split from #14",
      "Carved out of https://github.com/hearsay-tools/squeal/issues/14",
      "This was carved from #14: the cursor half.",
      "Split out of [#14](https://github.com/hearsay-tools/squeal/issues/14)",
      "Split out of Hearsay-Tools/Squeal#14",
    ]) {
      const candidates = buildCandidates({
        issue: issue(211, { body }),
        openIssues: [issue(14), issue(15)],
        repo,
        now,
      });
      expect(numbers(candidates), body).toEqual([15]);
    }
  });

  it("keeps the same-numbered issue here when the split-out parent is in another repository", () => {
    for (const body of [
      "Split out of hearsay-tools/cezarion#14",
      "Split out of https://github.com/hearsay-tools/cezarion/issues/14",
    ]) {
      expect([...splitParents(body, repo)], body).toEqual([]);
    }
  });

  it("does not treat a plain mention or a follow-up as a split-out parent", () => {
    expect([...splitParents("Related to #14. Follow-up to #15. See #16.", repo)]).toEqual([]);
    expect([...splitParents(null, repo)]).toEqual([]);
  });

  it("reads the title as well as the body and excludes every parent", () => {
    const parents = splitParents("Split out of #14 and split from #15", repo, "Split out of #16");
    expect([...parents].sort((a, b) => a - b)).toEqual([14, 15, 16]);
  });

  it("never offers a pull request and reduces labels to names", () => {
    const candidates = buildCandidates({
      issue: issue(211),
      openIssues: [
        issue(14, { labels: [{ name: "bug" }, "area-core"] }),
        issue(15, { pull_request: { url: "x" } }),
      ],
      repo,
      now,
    });
    expect(candidates).toEqual([
      {
        number: 14,
        title: "Issue 14",
        body: "",
        labels: ["bug", "area-core"],
        updated_at: "2026-10-01T00:00:00Z",
        open: true,
      },
    ]);
  });

  it("keeps the most recently updated candidates past the cap, in their original order", () => {
    const openIssues = [
      issue(1, { updated_at: "2026-10-03T00:00:00Z" }),
      issue(2, { updated_at: "2026-10-01T00:00:00Z" }),
      issue(3, { updated_at: "2026-10-04T00:00:00Z" }),
      issue(4, { updated_at: "2026-10-02T00:00:00Z" }),
    ];
    const candidates = buildCandidates({ issue: issue(211), openIssues, repo, now, max: 2 });
    expect(numbers(candidates)).toEqual([1, 3]);
    expect(MAX_CANDIDATES, 'a Jev Choice takes 255 options and one is "none"').toBe(254);
  });

  it("never offers an epic: a new issue under it is a child, not the same work", () => {
    const candidates = buildCandidates({
      issue: issue(211),
      openIssues: [issue(902, { labels: [{ name: "epic" }] }), issue(14, { labels: ["bug"] })],
      repo,
      now,
    });
    expect(numbers(candidates)).toEqual([14]);
  });

  it("rejects malformed input", () => {
    expect(() => buildCandidates({ issue: { number: 0 }, openIssues: [], repo })).toThrow(
      /issue number/,
    );
    expect(() => buildCandidates({ issue: issue(1), openIssues: {}, repo })).toThrow(/openIssues/);
    expect(() =>
      buildCandidates({ issue: issue(1), openIssues: [], closedIssues: {}, repo }),
    ).toThrow(/closedIssues/);
    expect(() => buildCandidates({ issue: issue(1), openIssues: [], repo: "nope" })).toThrow(
      /repo/,
    );
    expect(() =>
      buildCandidates({ issue: issue(1), openIssues: [], repo, now: "not a date" }),
    ).toThrow(/now/);
  });
});
