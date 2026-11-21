import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CommitWork, commitModeOf } from "../../src/core/daemon/commit-mode.js";
import { type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { DaemonExitReason } from "../../src/core/types/daemon.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Spec 023 D7.2 (row 023-39): a commit daemon's idle exit and cap, driven
 * through the real lifecycle timers with a test clock. Its idle period
 * replaces `daemon.idleExitMinutes` (60 here, so a 10 minute exit is the
 * commit mode's).
 */

const WT = "0123456789abcdef";
const MINUTE = 60_000;

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function timed() {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  const startedAt = clock as EpochMs;
  let lastActive = clock;
  let ended = 0;
  let work: CommitWork = { queued: 0, running: 0 };
  const shutdowns: { reason: DaemonExitReason; text: string }[] = [];
  const presence: Presence = { since: clock, lastPresentAt: null };
  const mode = commitModeOf({ commitMode: true }, dirname(commonDir));
  if (mode === null) throw new Error("no commit mode");
  let stop = () => {};
  stop = startTimers({
    root: dirname(commonDir),
    worktreeId: WT,
    commonDir,
    store,
    policy: { ...DEFAULT_POLICY, daemon: { idleExitMinutes: 60, unusedExitMinutes: 30 } },
    now: () => clock,
    linkedDir: null,
    timings: { checkMs: 10, presenceMs: 10 },
    heartbeatMs: 60 * MINUTE,
    presence,
    lastActive: () => lastActive,
    active: (at) => {
      lastActive = at;
    },
    requestProgress: () => ended,
    note: () => {},
    log: () => {},
    shutdown: (reason, text) => {
      shutdowns.push({ reason, text });
      stop();
    },
    commit: { mode, startedAt, work: () => work },
  });
  stops.push(stop);
  return {
    shutdowns,
    advance: (ms: number) => {
      clock += ms;
    },
    request: () => {
      lastActive = clock;
    },
    end: () => {
      ended += 1;
    },
    setWork: (next: CommitWork) => {
      work = next;
    },
  };
}

describe("a commit daemon's lifetime through the timers (D7.2)", () => {
  it("exits 10 minutes after its last request, with the idle reason", async () => {
    const t = timed();
    t.advance(5 * MINUTE);
    t.request();
    t.advance(10 * MINUTE - 1);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(1);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns.map((s) => s.reason)).toEqual(["idle"]);
    expect(t.shutdowns[0]?.text).toContain("10 min");
  });

  it("a request's ended file is activity, as for every daemon (row 018-12)", async () => {
    const t = timed();
    t.advance(9 * MINUTE);
    t.end();
    await delay(60);
    t.advance(9 * MINUTE);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
  });

  it("files waiting for a pool permit keep it past the idle period; it exits 10 minutes after they ran", async () => {
    const t = timed();
    t.setWork({ queued: 4, running: 0 });
    for (let step = 0; step < 4; step += 1) {
      t.advance(5 * MINUTE);
      await delay(60);
    }
    expect(t.shutdowns).toEqual([]);
    t.setWork({ queued: 0, running: 1 });
    t.advance(15 * MINUTE);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.setWork({ queued: 0, running: 0 });
    t.advance(10 * MINUTE - 1);
    await delay(60);
    expect(t.shutdowns).toEqual([]);
    t.advance(1);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the idle exit");
    expect(t.shutdowns.map((s) => s.reason)).toEqual(["idle"]);
  });

  it("exits at its 3 hour cap even while busy", async () => {
    const t = timed();
    t.setWork({ queued: 2, running: 1 });
    for (let hour = 0; hour < 3; hour += 1) {
      t.advance(60 * MINUTE - (hour === 2 ? 1 : 0));
      await delay(40);
    }
    expect(t.shutdowns).toEqual([]);
    t.advance(1);
    await waitFor(() => t.shutdowns.length > 0, 2_000, "the cap");
    expect(t.shutdowns.map((s) => s.reason)).toEqual(["lifetime-cap"]);
  });
});
