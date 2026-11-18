import { describe, expect, it } from "vitest";
import { markStopped } from "../../src/core/presence/events.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/presence/heartbeat.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookResult } from "../../src/harness/claude-code/run.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-156: on a loaded host a daemon SessionStart spawns can take more
 * than its 750 ms settle to heartbeat (1.1 s hook, first heartbeat at 1.5 s,
 * load 127). Its registration said "No daemon is running" and the next tool
 * boundary "a daemon is validating again", a pair an agent reads as an
 * outage. A registration after a spawn now says a daemon is starting, its
 * first heartbeat is no news, and a daemon that never heartbeats is reported
 * down once `DAEMON_START_GRACE_MS` has passed. Row 005-98: SessionStart
 * registers before it spawns, so its registration always says so.
 */

const T = Date.UTC(2026, 0, 2, 14, 2);
/** Row 005-98: how long the registration waited for a spawned daemon's heartbeat before. */
const SETTLE_BEFORE_MS = 750;
const STARTING = "A daemon is starting; results are as of revision 1.";
const context = (out: HookResult): string =>
  (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

function deps(
  result: "alive" | "spawned" | "unavailable",
  now?: number,
  onEnsure?: () => void,
): HookDeps {
  return {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    ...(now === undefined ? {} : { now: () => now }),
    ensureDaemon: async () => {
      onEnsure?.();
      return result;
    },
  };
}

/**
 * A worktree with one passing check and no daemon, whose SessionStart at `T`
 * spawned one that has not heartbeat.
 */
async function startedAtT(): Promise<{ r: SquealRepo; start: HookResult }> {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon("none");
  const start = await runHook(
    "session-start",
    recorded("session-start", r.root),
    deps("spawned", T),
  );
  return { r, start };
}

const batch = (r: SquealRepo, now?: number) =>
  runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps("spawned", now));

describe("SessionStart after spawning a daemon", () => {
  // Row 005-98 (option A): the registration comes before the spawn, and nothing waits for the
  // new daemon's heartbeat (up to 750 ms before).
  it("registers before the spawn and says a daemon is starting, with no wait for its heartbeat", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    let registeredAtSpawn = false;
    const started = performance.now();
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps("spawned", T, () => {
        registeredAtSpawn = r.store.consumers.get(r.consumer()) !== null;
        r.daemon("alive");
      }),
    );

    expect(registeredAtSpawn).toBe(true);
    expect(performance.now() - started).toBeLessThan(SETTLE_BEFORE_MS);
    expect(context(out)).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(context(out)).toContain(` ${STARTING}`);
    expect(context(out)).not.toContain("No daemon");
  });

  it("says a daemon is starting when no heartbeat arrives", async () => {
    const { start } = await startedAtT();
    expect(context(start)).toContain(` ${STARTING}`);
    expect(context(start)).not.toContain("No daemon");
  });

  it("says nothing at the boundary after the starting daemon's first heartbeat", async () => {
    const { r } = await startedAtT();
    r.daemon("alive");
    expect((await batch(r)).stdout).toBe("");
    expect((await batch(r)).stdout).toBe("");
  });

  it(`says nothing while the daemon starts, up to ${DAEMON_START_GRACE_MS} ms`, async () => {
    const { r } = await startedAtT();
    expect((await batch(r, T + 1_000)).stdout).toBe("");
    expect((await batch(r, T + DAEMON_START_GRACE_MS)).stdout).toBe("");
  });

  it("says no daemon is validating, once, when no heartbeat came within the grace", async () => {
    const { r } = await startedAtT();
    const late = await batch(r, T + DAEMON_START_GRACE_MS + 1);
    expect(context(late)).toBe(
      "SQUEAL · no daemon is validating at revision 1\n" +
        "Revision 1 (changed src/math.ts). " +
        "No daemon is running; results are as of revision 1.",
    );
    expect((await batch(r, T + DAEMON_START_GRACE_MS + 2)).stdout).toBe("");
    // It comes up after all: that is news now.
    r.daemon("alive");
    expect(context(await batch(r))).toMatch(
      /^SQUEAL · a daemon is validating again at revision 1: its heartbeat is current\n/,
    );
  });

  it("says no daemon is validating when the daemon heartbeat and then stopped within the grace", async () => {
    const { r } = await startedAtT();
    r.daemon("stale", T + 100);
    r.store.worktrees.setDaemon(r.worktreeId, null);
    // Row 011-251: this boundary spawns a daemon after the stop, and marks that start.
    expect((await batch(r, T + 2_000)).stdout).toBe("");
    // That start's grace passes with no heartbeat, and the next spawn keeps its time.
    const out = await batch(r, T + 2_000 + DAEMON_START_GRACE_MS + 1);
    expect(context(out)).toMatch(/^SQUEAL · no daemon is validating at revision 1\n/);
    expect(context(out)).toContain("No daemon has validated since 14:02:00 UTC");
  });
});

/*
 * Row 011-20: `squeal stop` leaves its mark once the socket went, so a
 * SessionStart in between finds none and spawns; the mark lands while it
 * waits for the heartbeat. The daemon it spawned voids the mark at its first
 * heartbeat (task 011-08), so it is told as starting, and the mark only once
 * the start's grace passed.
 */
describe("a stop's mark that lands while a SessionStart spawns", () => {
  async function markedWhileStarting(): Promise<{ r: SquealRepo; start: HookResult }> {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const mark = () => markStopped(r.store, r.worktreeId, (T + 1) as EpochMs, null);
    const start = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps("spawned", T, mark),
    );
    return { r, start };
  }

  it("says a daemon is starting, and nothing while it starts", async () => {
    const { r, start } = await markedWhileStarting();
    expect(context(start)).toContain(` ${STARTING}`);
    expect(context(start)).not.toContain("stopped by request");
    expect((await batch(r, T + 1_000)).stdout).toBe("");
    expect((await batch(r, T + DAEMON_START_GRACE_MS)).stdout).toBe("");
  });

  it("says the daemon is stopped by request, once, when no heartbeat came within the grace", async () => {
    const { r } = await markedWhileStarting();
    const late = await batch(r, T + DAEMON_START_GRACE_MS + 1);
    expect(context(late)).toMatch(/^SQUEAL · the daemon is stopped by request at revision 1\n/);
    expect(context(late)).toContain("The daemon is stopped by request (`squeal stop`)");
    expect((await batch(r, T + DAEMON_START_GRACE_MS + 2)).stdout).toBe("");
  });
});

describe("a tool boundary that registers after spawning a daemon", () => {
  it("says a daemon is starting, and nothing once it heartbeats", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const first = await batch(r, T);
    expect(context(first)).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(context(first)).toContain(` ${STARTING}`);
    r.daemon("alive");
    expect((await batch(r)).stdout).toBe("");
  });

  it("still says no daemon is running when none was started", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const out = await runHook(
      "post-tool-batch",
      recorded("post-tool-batch", r.root),
      deps("unavailable"),
    );
    expect(context(out)).toContain(" No daemon is running; results are as of revision 1.");
    expect(context(out)).not.toContain("starting");
  });
});

/*
 * The signal for a running daemon is the store heartbeat: down once older
 * than two intervals (10 s at the default 5 s), compared at each boundary.
 * A 1 to 3 s event-loop stall leaves it at most 8 s old; on this host at
 * load 90 to 130 the five live daemons' heartbeats peaked at 7 s.
 */
describe("a running daemon's late heartbeat", () => {
  async function registeredWith(heartbeatAt: number) {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps("alive"));
    r.daemon("stale", heartbeatAt);
    return r;
  }

  it("is no news within two intervals of the last heartbeat", async () => {
    const r = await registeredWith(T);
    expect((await batch(r, T + 10_000)).stdout).toBe("");
  });

  it("is reported once past them, as late with its age (row 011-276)", async () => {
    const r = await registeredWith(T);
    // Row 005-91 (a): a minute late or more, so the late heartbeat is news by itself.
    const text = context(await batch(r, T + 60_001));
    expect(text).toMatch(/^SQUEAL · the daemon's heartbeat is late at revision 1\n/);
    expect(text).toContain(
      ` The daemon's heartbeat is late: the last one was 1 min ago, at ${new Date(T).toISOString()}; ` +
        "the daemon may be busy or stopped; results are as of revision 1.",
    );
  });
});
