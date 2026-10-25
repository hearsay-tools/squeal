import { describe, expect, it } from "vitest";
import { actsAtStop, holdActsAtStop } from "../../src/core/delivery/stop-news.js";
import type {
  DaemonLiveness,
  DaemonStopping,
  EpochMs,
  StatusHold,
} from "../../src/core/types/index.js";

/*
 * Row 011-215: which liveness changes are news at Stop on their own. Those
 * that name an action or leave no successor are; a handover within its bound
 * and a daemon validating again wait for the next boundary. Of hold changes,
 * a merge hold's start is (the coordinator, 2026-10-25).
 */

const AT = 1_800_000_000_000 as EpochMs;
const handover: DaemonStopping = {
  from: "0.1.295",
  since: AT,
  to: "0.1.296",
  boundAt: (AT + 130_000) as EpochMs,
  overdue: false,
};
const short = { of: "0.1.295@1#t", version: "0.1.295", claimed: "0.1.296", since: AT };

describe("actsAtStop (row 011-215)", () => {
  it.each<[string, DaemonLiveness]>([
    ["a daemon validating again", { state: "alive", lastHeartbeatAt: AT }],
    [
      "a daemon validating again with a late change feed",
      { state: "alive", lastHeartbeatAt: AT, late: { since: AT } },
    ],
    ["a handover to a named successor", { state: "down", since: AT, stopping: handover }],
  ])("is false for %s", (_, live) => {
    expect(actsAtStop(live)).toBe(false);
  });

  it.each<[string, DaemonLiveness]>([
    ["a daemon down with no successor", { state: "down", since: AT }],
    ["a daemon that never heartbeat", { state: "down", since: null }],
    ["a daemon stopped by request", { state: "down", since: AT, stopped: true }],
    [
      "a daemon stopping with no successor named",
      { state: "down", since: AT, stopping: { from: "0.1.295", since: AT, overdue: false } },
    ],
    [
      "a handover past its bound",
      { state: "down", since: AT, stopping: { ...handover, overdue: true } },
    ],
    [
      "a fresh heartbeat past its handover's bound",
      { state: "alive", lastHeartbeatAt: AT, stopping: { ...handover, overdue: true } },
    ],
    ["a handoff that ended short", { state: "alive", lastHeartbeatAt: AT, short }],
  ])("is true for %s", (_, live) => {
    expect(actsAtStop(live)).toBe(true);
  });
});

describe("holdActsAtStop (row 011-215)", () => {
  const merge = { cause: "merge" } as StatusHold;
  const command = { cause: "command" } as StatusHold;

  it("is true when a merge hold starts, beside any other change", () => {
    expect(holdActsAtStop({ now: [], ended: [], started: [merge] })).toBe(true);
    expect(
      holdActsAtStop({ now: [], ended: [{ cause: "merge" }], started: [command, merge] }),
    ).toBe(true);
  });

  it("is false for a command hold's start and for any end", () => {
    expect(holdActsAtStop({ now: [], ended: [], started: [command] })).toBe(false);
    expect(holdActsAtStop({ now: [], ended: [{ cause: "merge" }], started: [] })).toBe(false);
  });
});
