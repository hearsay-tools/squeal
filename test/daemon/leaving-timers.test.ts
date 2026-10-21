import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { lastDeparture, markLeaving } from "../../src/core/delivery/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type Consumer,
  type DaemonExitReason,
  DEFAULT_POLICY,
  LEAVING_GRACE_MS,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { waitFor } from "./helpers.js";

/*
 * Task 001-416, through the daemon's real timers with a test clock: a
 * subagent whose SubagentStop was killed after marking it leaving is dropped
 * at a heartbeat once the mark is older than `LEAVING_GRACE_MS`, with its
 * departure stamped, so the daemon then leaves at the departure grace.
 */

const WT = "0123456789abcdef";
const SUBAGENT: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "a0123456789abcdef" };

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe("a daemon whose only consumer's SubagentStop was killed (task 001-416)", () => {
  it("drops it after the leaving grace, stamps the departure and exits at the departure grace", async () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
    let clock = 1_000_000;
    const shutdowns: DaemonExitReason[] = [];
    const presence: Presence = { since: clock, lastPresentAt: null };
    let stop = () => {};
    stop = startTimers({
      root: dirname(commonDir),
      worktreeId: WT,
      commonDir,
      store,
      policy: { ...DEFAULT_POLICY, daemon: { idleExitMinutes: 60, unusedExitMinutes: 30 } },
      now: () => clock,
      linkedDir: null,
      timings: { checkMs: 10, presenceMs: 10, departureGraceMs: 3_000 },
      heartbeatMs: 10,
      presence,
      lastActive: () => clock,
      active: () => {},
      lastUsed: () => clock,
      used: () => {},
      work: () => ({ revision: 1, inUse: false }),
      note: () => {},
      log: () => {},
      shutdown: (reason) => {
        shutdowns.push(reason);
        stop();
      },
    });
    stops.push(stop);
    store.consumers.register(SUBAGENT, clock);
    store.transaction(() => markLeaving(store, SUBAGENT, clock));
    await waitFor(() => presence.lastPresentAt !== null, 2_000, "the consumer counted");

    clock += LEAVING_GRACE_MS;
    await new Promise((done) => setTimeout(done, 100));
    expect(store.consumers.get(SUBAGENT)).not.toBeNull();

    clock += 1;
    await waitFor(() => store.consumers.get(SUBAGENT) === null, 2_000, "the consumer dropped");
    expect(lastDeparture(store, WT)).toBe(clock);
    expect(shutdowns).toEqual([]);

    clock += 3_000;
    await waitFor(() => shutdowns.length > 0, 2_000, "the departure exit");
    expect(shutdowns).toEqual(["sessions-gone"]);
  });
});
