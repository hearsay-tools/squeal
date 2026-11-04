import { describe, expect, it } from "vitest";
import { lastHoldText, slowWaitReason, withLastHold } from "../../src/harness/shared/stop-text.js";

/*
 * Row 019-30's sentences in Stop's holds (`019-run-triggers/lessons.md`):
 * why a group at `stop` has not started (P5, option a), and the line of
 * the turn's last hold (P6).
 */

const E2E = [{ project: "", path: "test/e2e/a.test.ts" }];

describe("why a group has not started, at the bound (P5)", () => {
  it("names the group it follows and its count, after the files", () => {
    expect(
      slowWaitReason(6, E2E, 120_000, "squeal", false, "e2e", [{ group: "unit", pending: 872 }]),
    ).toBe(
      "Squeal policy checks puts the e2e group at stop and after 120 s 1 e2e test file is still " +
        "not current at revision 6: test/e2e/a.test.ts. They have not started: they run after " +
        "the unit group, which has 872 test files pending. `squeal run e2e --wait` waits for " +
        "their results.",
    );
  });

  it("names one file in the singular, and several groups with their counts", () => {
    const one = slowWaitReason(1, E2E, 300, "squeal", false, "e2e", [
      { group: "unit", pending: 1 },
    ]);
    expect(one).toContain("they run after the unit group, which has 1 test file pending.");
    const two = slowWaitReason(1, E2E, 300, "squeal", false, "e2e", [
      { group: "unit", pending: 872 },
      { group: "api", pending: 12 },
    ]);
    expect(two).toContain(
      "They have not started: they run after the unit and api groups, which have 872 and 12 test files pending.",
    );
  });

  it("is the text of before without a group named", () => {
    expect(slowWaitReason(1, E2E, 300, "squeal", false, "e2e", [])).toBe(
      slowWaitReason(1, E2E, 300, "squeal", false, "e2e"),
    );
  });
});

describe("the turn's last hold (P6)", () => {
  it("says no later Stop waits, and names the group's command", () => {
    expect(lastHoldText(["e2e"], "squeal")).toBe(
      "This is Stop's last hold this turn: no later Stop in it waits for the e2e group, and " +
        "`squeal run e2e --wait` runs it and waits for its results.",
    );
  });

  it("names every group of the hold, the default slow group in today's words", () => {
    expect(lastHoldText(["e2e", "slow"], "squeal")).toBe(
      "This is Stop's last hold this turn: no later Stop in it waits for the e2e group and the " +
        "slow tier, and `squeal run e2e --wait` and `squeal run --slow --wait` run them and " +
        "wait for their results.",
    );
  });

  it("is a line after the reason only for the last hold", () => {
    expect(withLastHold("Reason.", ["e2e"], "squeal", false)).toBe("Reason.");
    expect(withLastHold("Reason.", ["e2e"], "squeal", true)).toBe(
      `Reason.\n${lastHoldText(["e2e"], "squeal")}`,
    );
  });
});
