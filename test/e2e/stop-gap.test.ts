import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { e2eSuite, MATH, PLUGINS } from "./harness.js";
import { daemonProcesses, lockHolders, stoppedItself } from "./restart-evidence.js";

/*
 * Task 001-340, from 001-337's reproduction: the daemon's shutdown unlinks
 * its socket before it releases its lock (D10's order), and on a loaded host
 * it can stall between the two for seconds (an ext4 journal wait). The
 * daemon stopping itself there (`SQUEAL_TEST_PAUSE=stop-gap`, task 001-355)
 * models that stall. `squeal stop` must not say
 * stopped while the lock is held, and the daemon a SessionStart spawns in
 * that gap must take the lock once it is free instead of exiting silently.
 */

const fixture = e2eSuite();
/** How long the stopped daemon stays frozen after the SessionStart, so its replacement reaches the lock. */
const FROZEN_MS = 5_000;

describe.runIf(process.platform === "linux").each(PLUGINS)(
  "a daemon stalled between its socket and its lock, $name",
  (plugin) => {
    it("stop waits for its lock, and the replacement a SessionStart spawns serves", async (ctx) => {
      const e = fixture(ctx, plugin, { tmpfs: true });
      await e.hook("session-start", e.main, {}, { SQUEAL_TEST_PAUSE: "stop-gap" });
      const first = await e.daemonReady(e.main);
      await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0);
      const socket = socketPathFor(worktreeIdFor(e.main), { XDG_RUNTIME_DIR: e.runtime });

      let stopped = false;
      const stop = e.cli(e.main, ["stop"]).finally(() => {
        stopped = true;
      });
      const stalled = await stoppedItself(first.pid, 60_000);
      try {
        expect(stalled, "the daemon stopped in its stop gap").toBe(true);
        expect(existsSync(socket), "the socket went away").toBe(false);
        expect(lockHolders(e.main), "the stalled daemon holds its lock").toMatch(
          new RegExp(`WRITE\\s+${first.pid}\\s`),
        );
        const start = await e.hook("session-start", e.main, { session_id: "third-session" });
        expect(start.code).toBe(0);
        expect(start.text).toContain("A daemon is starting");
        // Long enough for the replacement to try the lock: before task 001-340 it lost it and exited.
        await sleep(FROZEN_MS);
        expect.soft(stopped, "stop has not said stopped while the lock is held").toBe(false);
        console.log(`001-340 frozen:\n${await daemonProcesses(e)}`);
      } finally {
        process.kill(first.pid, "SIGCONT");
      }

      const done = await stop;
      expect(done).toMatchObject({ code: 0, stdout: `Squeal daemon stopped for ${e.main}\n` });
      const second = await e.daemonReady(e.main, first.pid);
      expect(second.pid).not.toBe(first.pid);
      const status = await e.status(e.main);
      expect(status.daemonNotes.map((n) => n.text)).not.toContainEqual(
        expect.stringMatching(/gave up/),
      );
      // The replacement validates.
      await e.edit(e.main, "math", MATH("-"), (s) => s.knownFailures.length === 1);
    }, 240_000);
  },
);
