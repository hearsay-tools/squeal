import { existsSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { lockHolders } from "../e2e/restart-evidence.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  waitFor,
} from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Review 001-344, B2, the reviewer's probe: a step-down's old daemon closes
 * its socket before it lets go of its lock (D10), and a late hook of an
 * older plugin spawns its daemon in that gap. Since task 001-340 a daemon
 * that loses a lock no daemon serves waits for it, so it could take the lock
 * ahead of the newer successor, which then exited as a loser. SIGSTOP at the
 * socket's unlink holds the gap open, as long as the late spawn takes to
 * decide. Both older daemons run this repository's build at older versions.
 *
 * A late spawn of the stopping daemon's own version still waits and may win
 * the gap, D10's accepted case (task 001-345, the coordinator's call): it is
 * no older than the daemon that left, and the next newer boundary with no
 * older session registered steps it down.
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, sockets, hookDeps, hook, exitWithin } = stepDownKit(suite);

/** Spins until `path` is gone, with no event-loop turn between the unlink and the return. */
function spinUntilGone(path: string, ms: number): boolean {
  const deadline = Date.now() + ms;
  while (existsSync(path)) if (Date.now() > deadline) return false;
  return true;
}

/**
 * Spins until process `pid` holds `repo`'s lock database open, a retry that
 * lasts well under a millisecond; false past `ms`. Linux, from `/proc`.
 */
function spinUntilAtLock(pid: number, repo: FixtureRepo, ms: number): boolean {
  const lock = realpathSync(lockFileFor(repo.commonDir, repo.worktreeId));
  const deadline = Date.now() + ms;
  while (Date.now() <= deadline) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        if (readlinkSync(`/proc/${pid}/fd/${fd}`) === lock) return true;
      }
    } catch {
      // A descriptor closed while read.
    }
  }
  return false;
}

/**
 * Steps down the 0.1.1 daemon serving `repo` for this source's hooks and
 * freezes it between its socket's unlink and its lock release; its pid.
 */
async function stepDownIntoGap(repo: FixtureRepo): Promise<number> {
  const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.1 serving");
  const answer = await requestDaemon(repo.socketPath, { type: "step-down", version: HOOKS }, 5_000);
  expect(answer).toMatchObject({ ok: true, type: "step-down", steppingDown: true });
  const gone = spinUntilGone(repo.socketPath, 60_000);
  if (gone) process.kill(first.pid, "SIGSTOP");
  try {
    expect(gone, "the socket went away").toBe(true);
    expect(lockHolders(repo.root), "the stopping daemon holds its lock").toMatch(
      new RegExp(`WRITE\\s+${first.pid}\\s`),
    );
  } catch (error) {
    process.kill(first.pid, "SIGCONT");
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
      const old = start(buildAt("0.1.1"), repo);
      const frozen = await stepDownIntoGap(repo);
      // The requesting hook's successor, then the late hook's spawn.
      const successor = start(suite.cli, repo, ["--await-lock", "120000"]);
      try {
        const late = start(buildAt("0.1.0"), repo);
        // Before the fix it waited here for the lock, and took it once the old daemon let go.
        expect(await exitWithin(late, 30_000, repo)).toEqual({ code: 0, signal: null });
        expect(late.stderr()).toMatch(/another daemon serves/);
      } finally {
        process.kill(frozen, "SIGCONT");
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
      const old = start(buildAt("0.1.1"), repo);
      const frozen = await stepDownIntoGap(repo);
      const successor = start(suite.cli, repo, ["--await-lock", "120000"]);
      const pid = successor.child.pid ?? 0;
      try {
        // Seen at the lock twice, so past its first retry and the check after it,
        // which saw no record: then frozen, so the late spawn takes the lock first.
        expect(spinUntilAtLock(pid, repo, 30_000), "the successor at the lock").toBe(true);
        await delay(50);
        expect(spinUntilAtLock(pid, repo, 30_000), "the successor at the lock again").toBe(true);
        process.kill(pid, "SIGSTOP");
      } finally {
        process.kill(frozen, "SIGCONT");
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
        process.kill(pid, "SIGCONT");
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
