import { describe, expect, it } from "vitest";
import { combined, waitingText } from "../../src/cli/status-at-estimate-waits.js";

/*
 * Review 0.1.612 S1 (row 023-77): the holder line promises no turn. The
 * slot keeps no reservation, so a third worktree or another limit can take
 * it first: a file "can start after that run ends". A side that waits on
 * several groups makes no such promise, since one holder's run ends one
 * group's wait only. The real daemons' case is
 * `status-at-slot-holder.test.ts`.
 */

const SLOT = "the browser group's slot, which the working tree's run of a.e2e.ts holds";

describe("the slot holder's line (review 0.1.612 S1)", () => {
  it("says the file can start after the holder's run ends, not that it will", () => {
    const one = waitingText({ reason: SLOT, capacity: true, holder: true }, 1);
    expect(one).toBe(`waiting for ${SLOT}; it can start after that run ends`);
    const two = waitingText({ reason: SLOT, capacity: true, holder: true }, 2);
    expect(two).toBe(`waiting for ${SLOT}; the first can start after that run ends`);
  });

  it("promises nothing for waits of several groups, one of them held", () => {
    const wait = combined([
      { reason: SLOT, capacity: true, holder: true },
      { reason: "the e2e group's slot", capacity: true },
    ]);
    expect(wait.holder).toBeUndefined();
    expect(waitingText(wait, 2)).toBe(`waiting for capacity (${SLOT}; the e2e group's slot)`);
  });

  it("keeps the line for one held wait shared by several groups", () => {
    const wait = combined([
      { reason: SLOT, capacity: true, holder: true },
      { reason: SLOT, capacity: true, holder: true },
    ]);
    expect(wait).toEqual({ reason: SLOT, capacity: true, holder: true });
  });
});
