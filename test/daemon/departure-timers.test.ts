import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { drop } from "../../src/core/delivery/expiry.js";
import { recordHarness } from "../../src/core/delivery/harness-process.js";
import { departedMetaKey, pidNamespace } from "../../src/core/delivery/index.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type Consumer,
  type DaemonExitReason,
  DEFAULT_POLICY,
  type Store,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Lessons, defect 24, the human's rule: a daemon that had a consumer exits
 * once none was registered for the 3 s grace; one that never had a consumer
 * keeps the idle period. Driven through the real timers with a test clock.
 */

const WT = "0123456789abcdef";
const S1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const S2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

interface Timed {
  readonly store: Store;
  readonly shutdowns: DaemonExitReason[];
  readonly presence: Presence;
  readonly now: () => number;
  advance(ms: number): void;
}

function timed(options: { idleExitMinutes?: number; heartbeatMs?: number } = {}): Timed {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  let lastActive = clock;
  const shutdowns: DaemonExitReason[] = [];
  const presence: Presence = { since: clock, lastPresentAt: null };
  stops.push(
    startTimers({
      root: dirname(commonDir),
      worktreeId: WT,
      commonDir,
      store,
      policy: {
        ...DEFAULT_POLICY,
        daemon: { ...DEFAULT_POLICY.daemon, idleExitMinutes: options.idleExitMinutes ?? 60 },
      },
      now: () => clock,
      linkedDir: null,
      timings: { checkMs: 10, presenceMs: 10, departureGraceMs: 3_000 },
      heartbeatMs: options.heartbeatMs ?? 60 * 60_000,
      presence,
      lastActive: () => lastActive,
      active: (at) => {
        lastActive = at;
      },
      note: () => {},
      log: () => {},
      shutdown: (reason) => shutdowns.push(reason),
    }),
  );
  return {
    store,
    shutdowns,
    presence,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe("departure exit (defect 24)", () => {
  it("exits once no consumer was counted for the grace after the last one left", async () => {
    const t = timed();
    t.store.consumers.register(S1, 1);
    await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
    t.store.consumers.unregister(S1);
    t.advance(2_900);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(200);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the departure exit");
    expect(t.shutdowns[0]).toBe("sessions-gone");
  });

  it("exits after a session that registered and left between two counts", async () => {
    const t = timed();
    // Synchronously, so no count of the timers ever sees it: only the departure stamp does.
    t.store.consumers.register(S1, t.now());
    t.store.transaction(() => drop(t.store, S1, t.now()));
    t.advance(2_900);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(200);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the departure exit");
    expect(t.shutdowns).toEqual(["sessions-gone"]);
  });

  it("ignores a departure stamped before it started", async () => {
    const t = timed({ idleExitMinutes: 1 });
    t.store.meta.set(departedMetaKey(WT), String(t.now() - 1));
    t.advance(10_000);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
  });

  it("a session that registers within the grace keeps the daemon", async () => {
    const t = timed();
    t.store.consumers.register(S1, 1);
    await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
    t.store.consumers.unregister(S1);
    t.advance(2_000);
    await delay(40);
    // `/clear`: SessionEnd of the old session id, SessionStart of a new one.
    t.store.consumers.register(S2, 1);
    await delay(40);
    t.advance(10_000);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
  });

  it("a daemon that never had a consumer keeps the idle period (squeal start)", async () => {
    const t = timed({ idleExitMinutes: 1 });
    t.advance(30_000);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(30_000);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns).toEqual(["idle"]);
  });

  it.runIf(process.platform === "linux")(
    "drops a consumer whose harness process is gone at the heartbeat, then exits",
    async () => {
      const t = timed({ heartbeatMs: 50 });
      t.store.consumers.register(S1, 1);
      // No process has PID 2^22 + 1 (above `pid_max`) in this namespace.
      const namespace = pidNamespace();
      t.store.transaction(() =>
        recordHarness(t.store, S1, { pid: 4_194_305, startTime: 1, pidNamespace: namespace ?? "" }),
      );
      await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
      await waitFor(() => t.store.consumers.get(S1) === null, 2_000, "the consumer dropped");
      expect(t.shutdowns).toEqual([]);
      t.advance(3_000);
      await waitFor(() => t.shutdowns.length > 0, 2_000, "the departure exit");
      expect(t.shutdowns).toEqual(["sessions-gone"]);
    },
  );
});
