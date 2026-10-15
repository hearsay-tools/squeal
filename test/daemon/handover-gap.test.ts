import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { lockHolders, resume, stoppedItself } from "../e2e/restart-evidence.js";
import { daemonSuite, delay, type FixtureRepo, ping, readNotes, SLOW, waitFor } from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Review 001-344, B2, the reviewer's probe: a step-down's old daemon closes
 * its socket before it lets go of its lock (D10), and a late hook of an
 * older plugin spawns its daemon in that gap. Since task 001-340 a daemon
 * that loses a lock no daemon serves waits for it, so it could take the lock
 * ahead of the newer successor, which then exited as a loser. The old daemon
 * stops itself in the gap (`SQUEAL_TEST_PAUSE=stop-gap`, task 001-355) and holds
 * it open as long as the late spawn takes to decide. Both older daemons run this repository's build at older versions.
 *
 * A late spawn of the stopping daemon's own version still waits and may win
 * the gap, D10's accepted case (task 001-345, the coordinator's call): it is
 * no older than the daemon that left, and the next newer boundary with no
 * older session registered steps it down.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets, hookDeps, hook, exitWithin } = stepDownKit(suite);

/** The 0.1.1 daemon, which stops itself in its stop gap (task 001-355). */
const STOP_GAP = { SQUEAL_TEST_PAUSE: "stop-gap" } as const;
/** The successor of the second case, which stops itself once it waits for the lock. */
const LOCK_WAIT = { SQUEAL_TEST_PAUSE: "lock-wait" } as const;

/**
 * Steps down the 0.1.1 daemon serving `repo` for this source's hooks, which
 * stops itself between its socket's unlink and its lock release; its pid.
 */
async function stepDownIntoGap(repo: FixtureRepo): Promise<number> {
  const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.1 serving");
  const answer = await requestDaemon(repo.socketPath, { type: "step-down", version: HOOKS }, 5_000);
  expect(answer).toMatchObject({ ok: true, type: "step-down", steppingDown: true });
  const stopped = await stoppedItself(first.pid, 60_000);
  try {
    expect(stopped, "the daemon stopped in its stop gap").toBe(true);
    expect(existsSync(repo.socketPath), "the socket went away").toBe(false);
    expect(lockHolders(repo.root), "the stopping daemon holds its lock").toMatch(
      new RegExp(`WRITE\\s+${first.pid}\\s`),
    );
  } catch (error) {
    resume(first.pid);
    throw error;
  }
  return first.pid;
}

describe.runIf(process.platform === "linux")(
  "a late older spawn in a step-down's stop gap (review 001-344, B2)",
  SLOW,
  () => {
    it("exits as a loser with no note, and the successor serves", async () => {
      const repo = suite.fixture();
      const old = start(buildAt("0.1.1"), repo, [], STOP_GAP);
      const frozen = await stepDownIntoGap(repo);
      // The requesting hook's successor, then the late hook's spawn.
      const successor = start(suite.cli, repo, ["--await-lock", "120000"]);
      try {
        const late = start(buildAt("0.1.0"), repo);
        // Before the fix it waited here for the lock, and took it once the old daemon let go.
        expect(await exitWithin(late, 30_000, repo)).toEqual({ code: 0, signal: null });
        expect(late.stderr()).toMatch(/another daemon serves/);
      } finally {
        resume(frozen);
      }

      expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
      const next = await waitFor(
        async () => {
          const pong = await ping(repo.socketPath, 500);
          return pong !== null && pong.pid !== frozen ? pong : null;
        },
        60_000,
        "the successor serving",
      );
      expect(next).toMatchObject({ pid: successor.child.pid, squealVersion: HOOKS });
      await delay(500);
      expect(successor.child.exitCode).toBeNull();
      expect(readNotes(repo).filter((n) => /gave up/.test(n))).toEqual([]);
    });

    it("a late spawn of the stopping daemon's version may win, the successor exits silently, and the next newer boundary steps it down", async () => {
      const repo = suite.fixture();
      const old = start(buildAt("0.1.1"), repo, [], STOP_GAP);
      const frozen = await stepDownIntoGap(repo);
      const successor = start(suite.cli, repo, ["--await-lock", "120000"], LOCK_WAIT);
      const pid = successor.child.pid ?? 0;
      try {
        // Past its first retry and the check after it, which saw no record, it stops
        // itself, so the late spawn takes the lock first.
        expect(await stoppedItself(pid, 60_000), "the successor stopped in its lock wait").toBe(
          true,
        );
      } finally {
        resume(frozen);
      }
      const late = start(buildAt("0.1.1"), repo);
      try {
        expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
        const won = await waitFor(
          async () => {
            const pong = await ping(repo.socketPath, 500);
            return pong !== null && pong.pid !== frozen ? pong : null;
          },
          60_000,
          "the late spawn serving",
        );
        expect(won).toMatchObject({ pid: late.child.pid, squealVersion: "0.1.1" });
      } finally {
        resume(pid);
      }
      expect(await exitWithin(successor, 30_000, repo)).toEqual({ code: 0, signal: null });
      expect(successor.stderr()).toMatch(/another daemon serves/);
      expect(readNotes(repo).filter((n) => /gave up/.test(n))).toEqual([]);

      // No older session is registered: the next newer boundary steps it down.
      const ensured: EnsureDaemonResult[] = [];
      sockets.push(repo.socketPath);
      await hook("session-start", repo, hookDeps(repo, ensured), "new");
      expect(ensured).toEqual(["spawned"]);
      expect(await exitWithin(late, 30_000, repo)).toEqual({ code: 0, signal: null });
      await waitFor(
        async () => (await ping(repo.socketPath, 500))?.squealVersion === HOOKS,
        60_000,
        "a current daemon serving",
      );
    });
  },
);
