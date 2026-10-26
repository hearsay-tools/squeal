import { afterEach, describe, expect, it } from "vitest";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { clearStartMark, markStart } from "../../src/core/daemon/start-mark.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/delivery/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Review 0.1.355 B1 (011 C9 as amended 2026-10-26, row 011-251): a daemon
 * killed with its record left (no shutdown mark), and the one a hook
 * spawned in its place, which holds the lock and marks its start before it
 * opens the store. The boundary reads the start as its header does: no news
 * while the start is marked, one "no daemon is validating" once the start
 * failed and its marks no longer apply, none at the new daemon's first
 * heartbeat.
 */

const STALE = Date.UTC(2026, 0, 2, 14, 2);
// With the marks gone the header probes the free lock, and names the killed daemon's death.
const DOWN =
  "SQUEAL · no daemon is validating at revision 1\n" +
  "Revision 1: no check pending, stale or unknown. " +
  "No daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1. " +
  "The last daemon died without shutting down, between runs. " +
  "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

const context = (out: HookResult): string =>
  (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
});

/** A consumer told alive at its registration, then its daemon killed and a replacement marking its start. */
async function replaced() {
  const r = squealRepo();
  r.apply(r.pass());
  let clock = Date.now();
  const deps = (ensured: "alive" | "spawned"): HookDeps => ({
    env: {},
    now: () => clock,
    ensureDaemon: async () => ensured,
  });
  await runHook("session-start", recorded("session-start", r.root), deps("alive"));
  r.daemon("stale", STALE);
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  const taken = acquireDaemonLock(lockFile);
  if (taken === null) throw new Error("the lock is taken");
  const lock = markStart(lockFile, taken);
  locks.push(lock);
  const batch = (ms = 0) => {
    clock += ms;
    return runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps("spawned"));
  };
  return { r, lock, lockFile, batch, clock: () => clock };
}

describe("a stale record and a replacement that marks its start (review 0.1.355 B1)", () => {
  it("gives no news while the start is marked, and one notice once it failed and its marks no longer apply", async () => {
    const { lock, batch } = await replaced();

    expect((await batch()).stdout).toBe("");
    expect((await batch(1_000)).stdout).toBe("");

    // The start fails: the lock and its start mark go; the spawn mark's grace passes.
    lock.release();
    const told = await batch(DAEMON_START_GRACE_MS + 1);

    expect(context(told)).toBe(DOWN);
    expect((await batch(1_000)).stdout).toBe("");
  });

  it("gives no news at the new daemon's first heartbeat", async () => {
    const { r, lock, lockFile, batch, clock } = await replaced();
    expect((await batch()).stdout).toBe("");

    // Its registration: a new record, both marks removed, the lock kept.
    clearStartMark(lockFile);
    r.store.worktrees.setDaemon(r.worktreeId, {
      socketPath: `/tmp/squeal-test-${r.worktreeId}.sock`,
      startedAt: clock() + 500,
      heartbeatAt: clock() + 500,
      heartbeatIntervalMs: 3_600_000,
      squealVersion: "0.0.0-test",
    });

    expect((await batch(1_000)).stdout).toBe("");
    expect((await batch(1_000)).stdout).toBe("");
    lock.release();
  });

  it("names the start in the header of other news, under a title that does not say none validates", async () => {
    const { r, batch } = await replaced();
    expect((await batch()).stdout).toBe("");
    r.apply(r.fail());

    const text = context(await batch(1_000));

    expect(text).not.toContain("no daemon is validating");
    expect(text).not.toContain("No daemon has validated");
    expect(text).toContain("A daemon is starting; results are as of revision 2.");
  });
});
