import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { lockHolders } from "../e2e/restart-evidence.js";
import {
  daemonSuite,
  delay,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
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
 */

const suite = daemonSuite();
const { HOOKS, buildAt, start, exitWithin } = stepDownKit(suite);

/** Spins until `path` is gone, with no event-loop turn between the unlink and the return. */
function spinUntilGone(path: string, ms: number): boolean {
  const deadline = Date.now() + ms;
  while (existsSync(path)) if (Date.now() > deadline) return false;
  return true;
}

describe.runIf(process.platform === "linux")(
  "a late older spawn in a step-down's stop gap (review 001-344, B2)",
  SLOW,
  () => {
    it("exits as a loser with no note, and the successor serves", async () => {
      const repo = suite.fixture();
      const old = start(buildAt("0.1.1"), repo);
      const first = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.1 serving");
      const answer = await requestDaemon(
        repo.socketPath,
        { type: "step-down", version: HOOKS },
        5_000,
      );
      expect(answer).toMatchObject({ ok: true, type: "step-down", steppingDown: true });
      const gone = spinUntilGone(repo.socketPath, 60_000);
      if (gone) process.kill(first.pid, "SIGSTOP");
      let successor: SpawnedProcess | undefined;
      try {
        expect(gone, "the socket went away").toBe(true);
        expect(lockHolders(repo.root), "the stopping daemon holds its lock").toMatch(
          new RegExp(`WRITE\\s+${first.pid}\\s`),
        );
        // The requesting hook's successor, then the late hook's spawn.
        successor = start(suite.cli, repo, ["--await-lock", "120000"]);
        const late = start(buildAt("0.1.0"), repo);
        // Before the fix it waited here for the lock, and took it once the old daemon let go.
        expect(await exitWithin(late, 30_000, repo)).toEqual({ code: 0, signal: null });
        expect(late.stderr()).toMatch(/another daemon serves/);
      } finally {
        process.kill(first.pid, "SIGCONT");
      }

      expect(await exitWithin(old, 30_000, repo)).toEqual({ code: 0, signal: null });
      const next = await waitFor(
        async () => {
          const pong = await ping(repo.socketPath, 500);
          return pong !== null && pong.pid !== first.pid ? pong : null;
        },
        60_000,
        "the successor serving",
      );
      expect(next).toMatchObject({ pid: successor?.child.pid, squealVersion: HOOKS });
      await delay(500);
      expect(successor?.child.exitCode).toBeNull();
      expect(readNotes(repo).filter((n) => /gave up/.test(n))).toEqual([]);
    });
  },
);
