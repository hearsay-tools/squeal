import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { DaemonExitReason } from "../../src/core/types/daemon.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Row 018-12 (spec 018 wave 3.6, the human 2026-11-09): a daemon that never
 * had a consumer (CI, `squeal start`) stopped for idleness with 332 files of
 * a `run tests` request still queued, because only a new request was
 * activity. Each end of a file an explicit request queued is activity now
 * (`TimerContext.requestProgress`): the daemon serves a request that keeps
 * making progress and stops one idle period after its last end. Driven
 * through the real timers with a test clock.
 */

const WT = "0123456789abcdef";
const S1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const MINUTE = 60_000;

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

interface Timed {
  readonly store: Store;
  readonly shutdowns: DaemonExitReason[];
  readonly presence: Presence;
  advance(ms: number): void;
  /** A file of an open explicit request ended. */
  end(): void;
}

function timed(options: { unusedExitMinutes?: number } = {}): Timed {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  let lastActive = clock;
  let lastUsed = clock;
  let ended = 0;
  const shutdowns: DaemonExitReason[] = [];
  const presence: Presence = { since: clock, lastPresentAt: null };
  let stop = () => {};
  stop = startTimers({
    root: dirname(commonDir),
    worktreeId: WT,
    commonDir,
    store,
    policy: {
      ...DEFAULT_POLICY,
      daemon: { idleExitMinutes: 1, unusedExitMinutes: options.unusedExitMinutes ?? 30 },
    },
    now: () => clock,
    linkedDir: null,
    timings: { checkMs: 10, presenceMs: 10, departureGraceMs: 3_000 },
    heartbeatMs: 60 * MINUTE,
    presence,
    lastActive: () => lastActive,
    active: (at) => {
      lastActive = at;
    },
    lastUsed: () => lastUsed,
    used: (at) => {
      lastUsed = at;
    },
    // The backlog is no use (row 011-92): only the request's ends can keep the daemon.
    work: () => ({ revision: 1, inUse: false, queued: 1 }),
    requestProgress: () => ended,
    note: () => {},
    log: () => {},
    shutdown: (reason) => {
      shutdowns.push(reason);
      stop();
    },
  });
  stops.push(stop);
  return {
    store,
    shutdowns,
    presence,
    advance: (ms) => {
      clock += ms;
    },
    end: () => {
      ended += 1;
    },
  };
}

describe("a request's progress is activity for the idle exit (row 018-12)", () => {
  it("a daemon with no consumer serves a request past the idle period, then stops one idle period after its last end", async () => {
    const t = timed();
    // Three files end 50 s apart: 150 s in all, past the 60 s idle period.
    for (let file = 0; file < 3; file += 1) {
      t.advance(50_000);
      t.end();
      await delay(60);
      expect(t.shutdowns).toEqual([]);
    }
    // The request ended, or stopped making progress: one idle period from its last end.
    t.advance(59_000);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(1_000);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns).toEqual(["idle"]);
  });

  it("with no request ending, the daemon's own work keeps today's idle exit", async () => {
    const t = timed();
    t.advance(59_000);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(1_000);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns).toEqual(["idle"]);
  });

  it("a request's progress is use for the unused stop of a daemon with a consumer", async () => {
    const t = timed({ unusedExitMinutes: 1 });
    t.store.consumers.register(S1, 1);
    await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
    for (let file = 0; file < 3; file += 1) {
      t.advance(50_000);
      t.end();
      await delay(60);
      expect(t.shutdowns).toEqual([]);
    }
    t.advance(60_000);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the unused stop");
    expect(t.shutdowns).toEqual(["idle"]);
  });
});
