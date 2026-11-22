import { describe, expect, it } from "vitest";
import { originText } from "../../src/cli/status-at-report-files.js";
import { maybeStored } from "../../src/cli/status-at-run-outcome.js";

/*
 * Review wave-13 third look, the accepted limit (the human, 2026-11-19):
 * a stop while a batch's completion record was being rewritten after a
 * keep that landed leaves the record before it. That state says the
 * result may have been stored and the next status --at shows it, never
 * that it was not stored. Row 023-41 removed the in-call run's report
 * lines; `squeal proof`'s run child keeps the reason.
 */

describe("review wave-13 third look: a record cut before it said whether the gate kept a file", () => {
  it("says the result may have been stored and the next status --at shows it", () => {
    const reason = maybeStored(true);
    expect(reason).toBe(
      "the run was stopped at the budget before its record said whether the gate kept it; it may have been stored, and the next status --at shows it",
    );
    const origin = {
      kind: "run",
      worktreeId: null,
      commit: "c",
      stored: false,
      notStored: reason,
    } as const;
    expect(originText(origin)).toBe(
      "run by this command; it may have been stored, and the next status --at shows it",
    );
    expect(
      originText({ ...origin, notStored: "the gate keeps a result only with coverage on" }),
    ).toBe("run by this command, not stored");
  });
});
