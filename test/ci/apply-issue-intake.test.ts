import { describe, expect, it } from "vitest";
import { loadIntake, planIntakeMutations } from "../../.github/scripts/apply-issue-intake.cjs";

const issueNumber = 211;
const knownLabels = new Set(["bug", "enhancement", "area-core", "duplicate"]);
// #14 is open, #5 was closed in the last 30 days.
const candidateOpen = new Map([
  [14, true],
  [5, false],
]);
const evidence = "Jev probability 0.87, same work 0.51";

function duplicateOf(number: number, labels: string[] = ["bug", "area-core"]) {
  return loadIntake({ action: "duplicate", duplicate_of: number, comment: evidence, labels });
}

function plan(intake: unknown, extra: Record<string, unknown> = {}) {
  return planIntakeMutations({
    intake,
    issueNumber,
    knownLabels,
    candidateOpen,
    closeDuplicates: true,
    ...extra,
  });
}

describe("planIntakeMutations", () => {
  it("labels, then closes, a duplicate of an open candidate when closing is on", () => {
    expect(plan(duplicateOf(14))).toEqual([
      ["issue", "edit", "211", "--add-label", "duplicate"],
      [
        "issue",
        "close",
        "211",
        "--reason",
        "duplicate",
        "--duplicate-of",
        "14",
        "--comment",
        `Duplicate of #14 (${evidence}).`,
      ],
    ]);
  });

  it("closes without the duplicate label when the repository lacks it", () => {
    expect(plan(duplicateOf(14), { knownLabels: new Set(["bug"]) })).toEqual([
      [
        "issue",
        "close",
        "211",
        "--reason",
        "duplicate",
        "--duplicate-of",
        "14",
        "--comment",
        `Duplicate of #14 (${evidence}).`,
      ],
    ]);
  });

  it("comments and labels instead of closing while ISSUE_INTAKE_CLOSE_DUPLICATES is off", () => {
    const mutations = plan(duplicateOf(14), { closeDuplicates: false });
    expect(mutations).toEqual([
      ["issue", "comment", "211", "--body", expect.stringMatching(/^Possibly the same as #14 /)],
      ["issue", "edit", "211", "--add-label", "bug,area-core"],
    ]);
    expect(mutations[0]?.[4]).toMatch(/ISSUE_INTAKE_CLOSE_DUPLICATES/);
    expect(mutations.flat()).not.toContain("close");
  });

  it("only comments on a duplicate of a closed candidate and leaves the issue open", () => {
    const mutations = plan(duplicateOf(5));
    expect(mutations).toEqual([
      ["issue", "comment", "211", "--body", `Possibly the same as #5, closed (${evidence}).`],
      ["issue", "edit", "211", "--add-label", "bug,area-core"],
    ]);
  });

  it("labels instead of closing when the pick is outside the candidate set, and says why", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    expect(plan(duplicateOf(211), { warn })).toEqual([
      ["issue", "edit", "211", "--add-label", "bug,area-core"],
    ]);
    expect(warnings[0]).toMatch(/#211 is not a duplicate candidate/);
    expect(plan(duplicateOf(13, []), { warn })).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it("adds only labels the repository has, and nothing when none remain", () => {
    const labeled = loadIntake({
      action: "label",
      duplicate_of: null,
      comment: null,
      labels: ["bug", "invented", "area-core"],
    });
    expect(plan(labeled)).toEqual([["issue", "edit", "211", "--add-label", "bug,area-core"]]);
    const unknown = loadIntake({
      action: "label",
      duplicate_of: null,
      comment: null,
      labels: ["invented"],
    });
    expect(plan(unknown)).toEqual([]);
  });

  it("plans nothing for skip", () => {
    const intake = loadIntake({
      action: "skip",
      duplicate_of: null,
      comment: null,
      labels: ["bug"],
    });
    expect(plan(intake)).toEqual([]);
  });

  it("never adds needs-triage: the workflow's last step does, unless the issue is closed", () => {
    const all = [duplicateOf(14), duplicateOf(5), duplicateOf(211)].flatMap((intake) => [
      ...plan(intake),
      ...plan(intake, { closeDuplicates: false }),
    ]);
    expect(all.flat().join(" ")).not.toMatch(/needs-triage/);
  });

  it("rejects malformed intake and refuses to act on another issue", () => {
    expect(() => loadIntake("not-json")).toThrow(/Invalid intake JSON/);
    expect(() => loadIntake({ action: "duplicate", duplicate_of: 14, comment: "x" })).toThrow(
      /labels/,
    );
    expect(() =>
      loadIntake({ action: "close", duplicate_of: null, comment: null, labels: [] }),
    ).toThrow(/action/);
    expect(() =>
      plan(
        loadIntake({
          action: "duplicate",
          duplicate_of: 211,
          comment: "x",
          labels: [],
        }),
        { candidateOpen: new Map([[211, true]]) },
      ),
    ).toThrow(/itself/);
    expect(() =>
      plan(loadIntake({ action: "duplicate", duplicate_of: null, comment: "x", labels: [] })),
    ).toThrow(/duplicate_of/);
    expect(() =>
      plan(loadIntake({ action: "duplicate", duplicate_of: 14, comment: null, labels: [] })),
    ).toThrow(/comment/);
    expect(() => plan(duplicateOf(14), { candidateOpen: new Set([14]) })).toThrow(/candidateOpen/);
  });
});
