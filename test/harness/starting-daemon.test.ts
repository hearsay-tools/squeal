import { describe, expect, it } from "vitest";
import { DAEMON_START_GRACE_MS } from "../../src/core/delivery/index.js";
import {
  type HookDeps,
  type HookResult,
  runHook,
  SPAWN_SETTLE_MS,
} from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-156: on a loaded host a daemon SessionStart spawns can take more
 * than `SPAWN_SETTLE_MS` to heartbeat (1.1 s hook, first heartbeat at 1.5 s,
 * load 127). Its registration said "No daemon is running" and the next tool
 * boundary "a daemon is validating again", a pair an agent reads as an
 * outage. A registration after a spawn now says a daemon is starting, its
 * first heartbeat is no news, and a daemon that never heartbeats is reported
 * down once `DAEMON_START_GRACE_MS` has passed.
 */

const T = Date.UTC(2026, 0, 2, 14, 2);
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
 * spawned one that has not heartbeat. `elapsed` is the hook's alone.
 */
async function startedAtT(): Promise<{ r: SquealRepo; start: HookResult; elapsed: number }> {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon("none");
  const started = performance.now();
  const start = await runHook(
    "session-start",
    recorded("session-start", r.root),
    deps("spawned", T),
  );
  return { r, start, elapsed: performance.now() - started };
}

const batch = (r: SquealRepo, now?: number) =>
  runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps("spawned", now));

describe("SessionStart after spawning a daemon", () => {
  // Review wave-13d S2: the heartbeat lands after the spawn returned and before the
  // settle's next look, in that order whatever the load, so the registration proves the wait.
  it("waits for the new daemon's heartbeat, so the registration says it validates", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    r.daemon("none");
    const out = await runHook(
      "session-start",
      recorded("session-start", r.root),
      deps("spawned", undefined, () => setImmediate(() => r.daemon("alive"))),
    );

    expect(context(out)).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(context(out)).not.toContain("No daemon");
    expect(context(out)).not.toContain("starting");
  });

  // A stall only lengthens the wait, so the bound is a lower one; the test's own timeout is the upper.
  it(`registers after ${SPAWN_SETTLE_MS} ms and says a daemon is starting when no heartbeat arrives`, async () => {
    const { start, elapsed } = await startedAtT();

    expect(elapsed).toBeGreaterThanOrEqual(SPAWN_SETTLE_MS - 10);
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
        "Revision 1 (changed src/math.ts): 1 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one). " +
        "No daemon is running; results are as of revision 1.",
    );
    expect((await batch(r, T + DAEMON_START_GRACE_MS + 2)).stdout).toBe("");
    // It comes up after all: that is news now.
    r.daemon("alive");
    expect(context(await batch(r))).toMatch(
      /^SQUEAL · a daemon is validating again at revision 1\n/,
    );
  });

  it("says no daemon is validating when the daemon heartbeat and then stopped within the grace", async () => {
    const { r } = await startedAtT();
    r.daemon("stale", T + 100);
    r.store.worktrees.setDaemon(r.worktreeId, null);
    const out = await batch(r, T + 2_000);
    expect(context(out)).toMatch(/^SQUEAL · no daemon is validating at revision 1\n/);
    expect(context(out)).toContain("No daemon has validated since 2026-01-02T14:02:00.100Z");
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

  it("is reported once past them", async () => {
    const r = await registeredWith(T);
    expect(context(await batch(r, T + 10_001))).toMatch(
      /^SQUEAL · no daemon is validating at revision 1\n/,
    );
  });
});
