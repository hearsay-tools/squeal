import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { acquireDaemonLock, type DaemonLock } from "../../src/core/daemon/lock.js";
import { clearStartMark, markStart } from "../../src/core/daemon/start-mark.js";
import { DAEMON_START_GRACE_MS } from "../../src/core/delivery/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Review 0.1.355 B1 (011 C9 as amended 2026-10-26, row 011-251): a daemon
 * killed with its record left (no shutdown mark), and the one a hook
 * spawned in its place, which holds the lock and marks its start before it
 * opens the store. The boundary reads the start as its header does: no news
 * while the start is marked, one notice once the start failed and its marks
 * no longer apply, none at the new daemon's first heartbeat. Row 011-276:
 * while the boundary's own spawn is marked no reader takes the lock, so that
 * notice says the heartbeat is late, not that the daemon stopped.
 */

const STALE = Date.UTC(2026, 0, 2, 14, 2);
const DOWN = new RegExp(
  "^SQUEAL · the daemon's heartbeat is late at revision 1\n" +
    "Revision 1 \\(changed src/math\\.ts\\): no check pending, stale or unknown\\. " +
    "The daemon's heartbeat is late: the last one was \\d+ (?:s|min|h) ago, at 2026-01-02T14:02:00\\.000Z; " +
    "the daemon may be busy or stopped; results are as of revision 1\\.$",
);
// With no mark in its grace the header probes the free lock, and names the killed daemon's death.
const DIED =
  "The last daemon died without shutting down, between runs. " +
  "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

// Status's words for it: plain status's no-daemon line and `--full`'s `Daemon:` line.
const STATUS_DIED = "; it died without shutting down, between runs";

/** What `squeal <argv>` prints in `r`'s worktree at `now`. */
async function squeal(r: SquealRepo, argv: string[], now: number): Promise<string> {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd: r.root,
    now: () => now as EpochMs,
    env: {},
  };
  await main(argv, io);
  return stdout;
}

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
    const { r, lock, batch, clock } = await replaced();

    expect((await batch()).stdout).toBe("");
    expect((await batch(1_000)).stdout).toBe("");

    // The start fails: the lock and its start mark go. No boundary spawned during the start (row
    // 011-252), so this one spawns and marks its spawn, and while that spawn is marked the header
    // and status take no lock (row 011-251, F4) and name no death (the coordinator, 2026-10-26).
    lock.release();
    const told = await batch(DAEMON_START_GRACE_MS + 1);

    expect(context(told)).toMatch(DOWN);
    for (const argv of [["status"], ["status", "--full"]]) {
      expect(await squeal(r, argv, clock())).not.toContain(STATUS_DIED);
    }
    expect((await batch(1_000)).stdout).toBe("");
    // That spawn's grace passes with no start: the header of the next news and status name the death.
    r.apply(r.fail());
    expect(context(await batch(DAEMON_START_GRACE_MS))).toContain(DIED);
    for (const argv of [["status"], ["status", "--full"]]) {
      expect(await squeal(r, argv, clock())).toContain(STATUS_DIED);
    }
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
