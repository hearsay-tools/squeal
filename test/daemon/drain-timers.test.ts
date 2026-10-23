import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DRAIN_SLOW_WAIT_MS, type Presence, startTimers } from "../../src/core/daemon/lifecycle.js";
import { storePaths } from "../../src/core/store/index.js";
import {
  type Consumer,
  type DaemonExitReason,
  DEFAULT_POLICY,
  type SlowWaiting,
  type Store,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { delay, waitFor } from "./helpers.js";

/*
 * Task 004-29, the human's rules (board row 001-162): a daemon whose last
 * session left with slow files pending drains them before it exits, for at
 * most `daemon.idleExitMinutes`; a session that registers during the drain
 * cancels the exit. Driven through the real timers with a test clock and a
 * stand-in for `Scheduler.slowPending`. Row 011-93 (011 C9 as amended
 * 2026-10-21): the drain pauses the backlog, and that registration ends the
 * pause. Row 011-163 (011 C9 as amended 2026-10-23): a stand-in for
 * `Scheduler.slowWaiting` tells since when the drain's slow files waited.
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
  readonly exits: { reason: DaemonExitReason; text: string }[];
  readonly notes: string[];
  readonly presence: Presence;
  advance(ms: number): void;
  now(): number;
  pending(value: boolean): void;
  waiting(value: SlowWaiting | null): void;
  owed(value: string | null): void;
  /** Each `pauseBacklog` call, in order. */
  readonly pauses: boolean[];
  /** Activity the idle timer saw. */
  readonly lastActive: () => number;
}

function timed(): Timed {
  const commonDir = fakeCommonDir();
  const store = open(commonDir);
  mkdirSync(storePaths(commonDir).locksDir, { recursive: true });
  let clock = 1_000_000;
  let lastActive = clock;
  let pending = true;
  let owed: string | null = null;
  let waiting: SlowWaiting | null = null;
  const exits: Timed["exits"] = [];
  const notes: string[] = [];
  const pauses: boolean[] = [];
  const presence: Presence = { since: clock, lastPresentAt: null };
  stops.push(
    startTimers({
      root: dirname(commonDir),
      worktreeId: WT,
      commonDir,
      store,
      policy: { ...DEFAULT_POLICY, daemon: { ...DEFAULT_POLICY.daemon, idleExitMinutes: 60 } },
      now: () => clock,
      linkedDir: null,
      timings: { checkMs: 10, presenceMs: 10, departureGraceMs: 3_000 },
      heartbeatMs: 60 * 60_000,
      presence,
      lastActive: () => lastActive,
      active: (at) => {
        lastActive = at;
      },
      slowPending: () => pending,
      owedWork: () => owed,
      pauseBacklog: (on) => pauses.push(on),
      slowWaiting: () => waiting,
      note: (text) => notes.push(text),
      log: () => {},
      shutdown: (reason, text) => exits.push({ reason, text }),
    }),
  );
  return {
    store,
    exits,
    notes,
    presence,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
    pending: (value) => {
      pending = value;
    },
    waiting: (value) => {
      waiting = value;
    },
    owed: (value) => {
      owed = value;
    },
    pauses,
    lastActive: () => lastActive,
  };
}

/** S1 registers, is counted, and leaves. */
async function leave(t: Timed): Promise<void> {
  t.store.consumers.register(S1, 1);
  await waitFor(() => t.presence.lastPresentAt !== null, 2_000, "the consumer counted");
  t.store.consumers.unregister(S1);
}

const DRAIN_NOTE = /^the last session ended with slow files pending; .* at most 60 min/;

describe("the departure drains pending slow files (task 004-29)", () => {
  it("runs on past the grace while slow files are pending, and exits once they ran", async () => {
    const t = timed();
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    expect(t.notes).toEqual([expect.stringMatching(DRAIN_NOTE)]);
    t.advance(30 * 60_000);
    await delay(60);
    expect(t.exits).toEqual([]);
    // One note for the drain, however long it takes.
    expect(t.notes).toHaveLength(1);

    t.pending(false);
    await waitFor(() => t.exits.length > 0, 2_000, "the drained exit");
    expect(t.exits[0]).toEqual({
      reason: "sessions-gone",
      text: "daemon stopped: the slow files pending when its last session ended have run",
    });
  });

  it("exits at the grace as before when no slow file is pending", async () => {
    const t = timed();
    t.pending(false);
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.exits.length > 0, 2_000, "the departure exit");
    expect(t.exits[0]?.text).toMatch(/no session registered for 3 s after its last one ended/);
    expect(t.notes).toEqual([]);
    expect(t.pauses).toEqual([]);
  });

  it("pauses the backlog when the drain starts; a session that registers ends the pause (row 011-93)", async () => {
    const t = timed();
    await leave(t);
    expect(t.pauses).toEqual([]);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    expect(t.pauses).toEqual([true]);
    t.store.consumers.register(S2, 1);
    await waitFor(() => t.presence.draining === false, 2_000, "the drain cancelled");
    await delay(60);
    expect(t.pauses).toEqual([true, false]);
  });

  it("a session that registers during the drain cancels the exit; the daemon serves on", async () => {
    const t = timed();
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    // `/clear`, `/new`, or a reopened harness.
    t.store.consumers.register(S2, 1);
    await waitFor(() => t.presence.draining === false, 2_000, "the drain cancelled");
    t.pending(false);
    t.advance(2 * 60 * 60_000);
    await delay(60);
    expect(t.exits).toEqual([]);

    // That session leaves with nothing pending: the grace, then the plain exit.
    t.store.consumers.unregister(S2);
    t.advance(3_100);
    await waitFor(() => t.exits.length > 0, 2_000, "the departure exit");
    expect(t.exits[0]?.text).toMatch(/no session registered for 3 s/);
  });

  it("is bounded by daemon.idleExitMinutes after the departure, and is no activity", async () => {
    const t = timed();
    await leave(t);
    const active = t.lastActive();
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    t.advance(60 * 60_000 - 3_200);
    await delay(60);
    expect(t.exits).toEqual([]);
    t.advance(200);
    await waitFor(() => t.exits.length > 0, 2_000, "the bound");
    expect(t.exits[0]).toEqual({
      reason: "sessions-gone",
      text:
        "daemon stopped: slow files were still pending 60 min after its last session ended " +
        "(daemon.idleExitMinutes)",
    });
    expect(t.lastActive()).toBe(active);
  });
});

describe("a drain ends when its slow files wait (row 011-163)", () => {
  it("exits 60 s after its slow lane began to wait, with one note naming the files left queued", async () => {
    const t = timed();
    t.owed("a new failure's re-run");
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    // Its fast work runs past the 60 s: no wait yet.
    t.advance(10 * 60_000);
    await delay(60);
    expect(t.exits).toEqual([]);

    const paths = Array.from({ length: 7 }, (_, i) => `test/e2e-${i}.test.ts`);
    t.waiting({ since: t.now(), paths });
    t.advance(DRAIN_SLOW_WAIT_MS - 100);
    await delay(60);
    expect(t.exits).toEqual([]);
    t.advance(200);
    await waitFor(() => t.exits.length > 0, 2_000, "the waited exit");
    expect(t.exits).toEqual([
      {
        reason: "sessions-gone",
        text:
          "daemon stopped: no slow file ran for 60 s once the fast work pending when its last " +
          "session ended was done; 7 slow files left queued for the next daemon in this " +
          "worktree: test/e2e-0.test.ts, test/e2e-1.test.ts, test/e2e-2.test.ts, " +
          "test/e2e-3.test.ts, test/e2e-4.test.ts and 2 more",
      },
    ]);
    expect(t.notes).toHaveLength(1);
  });

  it("a session that registers ends the drain, and its wait with it", async () => {
    const t = timed();
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    t.waiting({ since: t.now(), paths: ["test/e2e.test.ts"] });
    t.store.consumers.register(S2, 1);
    await waitFor(() => t.presence.draining === false, 2_000, "the drain cancelled");
    t.advance(2 * DRAIN_SLOW_WAIT_MS);
    await delay(60);
    expect(t.exits).toEqual([]);
  });
});

describe("the departure drains what Squeal owes (task 001-219)", () => {
  const CHECKPOINT = "a `run --all` checkpoint (3 test files left)";

  it("runs on past the grace while an explicit checkpoint is open, and exits once it ended", async () => {
    const t = timed();
    t.pending(false);
    t.owed(CHECKPOINT);
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    expect(t.notes).toEqual([
      `the last session ended with ${CHECKPOINT} pending; this daemon runs that work before ` +
        "it exits, for at most 60 min (daemon.idleExitMinutes)",
    ]);
    t.advance(10 * 60_000);
    await delay(60);
    expect(t.exits).toEqual([]);

    t.owed(null);
    await waitFor(() => t.exits.length > 0, 2_000, "the drained exit");
    expect(t.exits[0]).toEqual({
      reason: "sessions-gone",
      text: `daemon stopped: the work pending when its last session ended is done (${CHECKPOINT})`,
    });
  });

  it("names slow files and owed work together, and leaves the rest owed at the bound", async () => {
    const t = timed();
    t.owed("a new failure's re-run");
    await leave(t);
    t.advance(3_100);
    await waitFor(() => t.notes.length > 0, 2_000, "the drain note");
    expect(t.notes[0]).toMatch(
      /^the last session ended with slow files and a new failure's re-run pending/,
    );
    t.advance(60 * 60_000);
    await waitFor(() => t.exits.length > 0, 2_000, "the bound");
    expect(t.exits[0]?.text).toBe(
      "daemon stopped: still pending 60 min after its last session ended " +
        "(daemon.idleExitMinutes): slow files and a new failure's re-run; " +
        "the next daemon resumes what is owed",
    );
  });
});
