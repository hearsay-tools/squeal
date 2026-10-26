import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { stoppedLine } from "../cli/stop-lines.js";
import { e2eSuite, MATH, PLUGINS } from "./harness.js";
import {
  cliProcess,
  cliWith,
  daemonProcesses,
  lockHolders,
  resume,
  soon,
  stopMark,
  stoppedItself,
  testPause,
} from "./restart-evidence.js";

/*
 * Task 001-340, from 001-337's reproduction: the daemon's shutdown unlinks
 * its socket before it releases its lock (D10's order), and on a loaded host
 * it can stall between the two for seconds (an ext4 journal wait). The
 * daemon stopping itself there (`testPause("stop-gap")`, task 001-355)
 * models that stall. `squeal stop` must not say
 * stopped while the lock is held, and the daemon a SessionStart spawns in
 * that gap must take the lock once it is free instead of exiting silently.
 * Since task 011-08 a SessionStart after `squeal stop` starts nothing until
 * the next edit, so the agent edits in the gap first. Row 011-20: the stop
 * leaves its mark only once it saw the socket go, so that SessionStart can
 * find none, spawn, and read the mark while it waits for the spawned daemon's
 * heartbeat, which CI's loaded runners did six times. The stop pauses before
 * its mark (`testPause("stop-mark")`) until the SessionStart spawned, so the
 * mark lands in that wait every time.
 */

const fixture = e2eSuite();
/** How long the stopped daemon stays frozen after the SessionStart, so its replacement reaches the lock. */
const FROZEN_MS = 5_000;

describe.runIf(process.platform === "linux").each(PLUGINS)(
  "a daemon stalled between its socket and its lock, $name",
  (plugin) => {
    it("stop waits for its lock, and the replacement a SessionStart spawns serves", async (ctx) => {
      const e = fixture(ctx, plugin, { tmpfs: true });
      await e.hook("session-start", e.main, {}, testPause("stop-gap"));
      const first = await e.daemonReady(e.main);
      await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0);
      const socket = socketPathFor(worktreeIdFor(e.main), { XDG_RUNTIME_DIR: e.runtime });

      let stopped = false;
      const stop = cliWith(e, ["stop"], testPause("stop-mark")).finally(() => {
        stopped = true;
      });
      const stalled = await stoppedItself(first.pid, 60_000);
      const stopping = await soon(10_000, () => cliProcess(e, "stop"));
      try {
        expect(stalled, "the daemon stopped in its stop gap").toBe(true);
        expect(existsSync(socket), "the socket went away").toBe(false);
        expect(lockHolders(e.main), "the stalled daemon holds its lock").toMatch(
          new RegExp(`WRITE\\s+${first.pid}\\s`),
        );
        expect(stopping, "the stop's process").not.toBeNull();
        const paused = await stoppedItself(stopping ?? 0, 60_000);
        expect(paused, "the stop paused before its mark").toBe(true);
        expect(stopMark(e.main), "no mark yet").toBeNull();
        // Task 011-08: an edit while the daemon shuts down clears the stop's mark.
        writeFileSync(join(e.main, "edited-in-the-gap.txt"), "edit\n");
        let registered = false;
        const starting = e
          .hook("session-start", e.main, { session_id: "third-session" })
          .finally(() => {
            registered = true;
          });
        // It found no mark and spawned; the mark lands while it waits for a heartbeat.
        const spawned = await soon(30_000, () => cliProcess(e, "daemon", first.pid));
        expect(spawned, "the SessionStart spawned a replacement").not.toBeNull();
        resume(stopping ?? 0);
        expect(await soon(30_000, () => stopMark(e.main)), "the stop's mark").not.toBeNull();
        expect(registered, "the mark landed before the SessionStart registered").toBe(false);
        const start = await starting;
        expect(start.code).toBe(0);
        // Row 011-20: the daemon it spawned voids the mark at its first heartbeat.
        expect(start.text).toContain("A daemon is starting");
        // Long enough for the replacement to try the lock: before task 001-340 it lost it and exited.
        await sleep(FROZEN_MS);
        expect.soft(stopped, "stop has not said stopped while the lock is held").toBe(false);
        console.log(`001-340 frozen:\n${await daemonProcesses(e)}`);
      } finally {
        if (stopping !== null) resume(stopping);
        resume(first.pid);
      }

      const done = await stop;
      expect(done).toMatchObject({ code: 0, stdout: stoppedLine(e.main) });
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
