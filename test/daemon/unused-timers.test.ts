import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type Consumer,
  type DaemonExitReason,
  DEFAULT_POLICY,
  daemonRestMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Task 001-415 (the human, 2026-10-15; D10 as amended): a daemon whose
 * worktree keeps a consumer registered but that saw no edit, no tier, no wait
 * and no request for `daemon.unusedExitMinutes` stops. Driven through the
 * real timers with a test clock. Row 011-92 (011 C9 as amended 2026-10-21):
 * the backlog is no use, queued or running (`Scheduler.inUse`), and the
 * note names the test files the stop leaves queued.
 */

const WT = "0123456789abcdef";
const S1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const MINUTE = 60_000;

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

interface Unused {
  readonly store: Store;
  readonly shutdowns: { reason: DaemonExitReason; text: string }[];
  readonly presence: Presence;
  /** What the scheduler reports; `revision` moves on an edit. */
  readonly work: { revision: number; inUse: boolean; queued: number };
  advance(ms: number): void;
  request(): void;
}

function unused(): Unused {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  let lastActive = clock;
  let lastUsed = clock;
  const shutdowns: { reason: DaemonExitReason; text: string }[] = [];
  const presence: Presence = { since: clock, lastPresentAt: null };
  const work = { revision: 1, inUse: false, queued: 0 };
  // The daemon's shutdown stops its timers; so does this one.
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
    work: () => ({ ...work }),
    note: () => {},
    log: () => {},
    shutdown: (reason, text) => {
      shutdowns.push({ reason, text });
      stop();
    },
  });
  stops.push(stop);
  return {
    store,
    shutdowns,
    presence,
    work,
    advance: (ms) => {
      clock += ms;
    },
    request: () => {
      lastUsed = clock;
    },
  };
}

/** Moves the clock in checked steps, so every timer tick sees each step. */
async function pass(t: Unused, ms: number, step = 5 * MINUTE): Promise<void> {
  for (let left = ms; left > 0; left -= step) {
    t.advance(Math.min(step, left));
    await delay(40);
  }
}

async function registered(t: Unused): Promise<void> {
  t.store.consumers.register(S1, 1);
  await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
}

describe("the unused stop (task 001-415)", () => {
  it("stops a daemon with a consumer still registered once it was unused for the bound", async () => {
    const t = unused();
    await registered(t);
    await pass(t, 29 * MINUTE);
    expect(t.shutdowns).toEqual([]);
    await pass(t, MINUTE);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the unused stop");
    expect(t.shutdowns).toEqual([
      {
        reason: "idle",
        text:
          "daemon stopped: no edit, run, wait or request for 30 min (daemon.unusedExitMinutes), " +
          "with 1 session registered; the next hook starts it again",
      },
    ]);
    // The consumer stays: its next hook starts a daemon that serves it.
    expect(t.store.consumers.get(S1)).not.toBeNull();
  });

  it("stops with only the backlog queued or running, and names the files it leaves queued (row 011-92)", async () => {
    const t = unused();
    await registered(t);
    t.work.queued = 50;
    await pass(t, 30 * MINUTE);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the unused stop");
    expect(t.shutdowns).toEqual([
      {
        reason: "idle",
        text:
          "daemon stopped: no edit, run, wait or request for 30 min (daemon.unusedExitMinutes), " +
          "with 1 session registered and 50 test files queued; the next hook starts it again",
      },
    ]);
    expect(t.store.meta.get(daemonRestMetaKey(WT))).not.toBeNull();
  });

  it("an edit, a tier of its work or a request starts the bound again", async () => {
    const t = unused();
    await registered(t);
    await pass(t, 25 * MINUTE);
    t.work.revision = 2;
    await pass(t, 25 * MINUTE);
    t.work.inUse = true;
    await pass(t, 40 * MINUTE);
    t.work.inUse = false;
    await pass(t, 25 * MINUTE);
    t.request();
    await pass(t, 25 * MINUTE);
    expect(t.shutdowns).toEqual([]);
    await pass(t, 5 * MINUTE);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the unused stop");
    expect(t.shutdowns.map((s) => s.reason)).toEqual(["idle"]);
  });

  it("leaves a daemon with no consumer to the idle period (squeal start)", async () => {
    const t = unused();
    await pass(t, 45 * MINUTE);
    expect(t.shutdowns).toEqual([]);
    await pass(t, 15 * MINUTE);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns[0]?.text).toMatch(/with no registered consumers/);
  });
});
