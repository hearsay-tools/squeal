import { describe, expect, it } from "vitest";
import { groupsQuietText } from "../../src/cli/status-wait-groups.js";
import type { GroupTierState, StatusSnapshot } from "../../src/core/types/status.js";

/*
 * Row 023-67 (round 8, X2), the `status --wait` side: a request-only
 * group's files that `status --at --run` queued run now; the clause must
 * not say Squeal runs them only on request.
 */

function snapshot(requested: number): StatusSnapshot {
  const group = {
    name: "browser",
    at: "manual",
    after: [],
    quietMs: 0,
    testFiles: 97,
    current: 0,
    pending: 97,
    notRun: 0,
    activity: null,
    requested,
  } as unknown as GroupTierState;
  return { groupTiers: [group] } as unknown as StatusSnapshot;
}

describe("status --wait: a request-only group's requested files (row 023-67)", () => {
  it("says a request queued them and Squeal runs them now", () => {
    const text = groupsQuietText(snapshot(97), "squeal");
    expect(text).toContain("a request queued the pending ones: Squeal runs them now");
    expect(text).not.toContain("runs them only on request");
  });

  it("names the requested part apart from the rest", () => {
    const text = groupsQuietText(snapshot(40), "squeal");
    expect(text).toContain("a request queued 40: Squeal runs 40 now, the other 57 only on request");
  });

  it("keeps the moment when no request queued them", () => {
    expect(groupsQuietText(snapshot(0), "squeal")).toContain("Squeal runs them only on request");
  });
});
