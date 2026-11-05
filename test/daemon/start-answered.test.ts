import { afterEach, describe, expect, it } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type { DaemonRecord, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import { createFixtureRepo, type FixtureRepo, SLOW } from "./helpers.js";
import { spawnLog, startIn } from "./start-helpers.js";

/*
 * Row 011-295: `squeal start`'s first line agrees with the status it prints
 * below it. A daemon that answers its socket is `alive` only while status
 * says it validates; while status says otherwise, its daemon answered. The
 * decisions stay: `start` spawns nothing and exits 0 (row 011-111 waits
 * only for a daemon it spawned).
 */

const BOUNDS = { socketMs: 10_000, lockMs: 5_000, leftoversMs: 0 };

const cleanups: (() => void)[] = [];
const suite = { cleanup: (fn: () => void) => cleanups.push(fn) };

/** A fixture whose store has the worktree's row with `daemon` recorded, and a stand-in that answers its pings. */
async function answering(heartbeatAgoMs: number | null) {
  const repo = createFixtureRepo();
  cleanups.push(repo.cleanup);
  const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  const daemon = record(repo, heartbeatAgoMs ?? 0);
  store.worktrees.upsert({
    id: repo.worktreeId as WorktreeId,
    root: repo.root,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: heartbeatAgoMs === null ? null : daemon,
  });
  await fakeDaemon(repo.socketPath, {
    ping: [
      {
        ok: true,
        type: "ping",
        pid: process.pid,
        worktreeId: repo.worktreeId,
        root: repo.root,
        squealVersion: daemon.squealVersion,
        phase: "serving",
        startedAt: daemon.startedAt,
      },
    ],
  });
  return repo;
}

function record(repo: FixtureRepo, heartbeatAgoMs: number): DaemonRecord {
  const now = Date.now();
  return {
    socketPath: repo.socketPath,
    startedAt: (now - 60_000) as EpochMs,
    heartbeatAt: (now - heartbeatAgoMs) as EpochMs,
    heartbeatIntervalMs: 5_000,
    squealVersion: squealVersion(),
    token: "t",
  };
}

describe.runIf(process.platform === "linux")(
  "squeal start says what the status below it says (row 011-295)",
  SLOW,
  () => {
    afterEach(() => {
      closeFakeDaemons();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    it("says alive above a status that says the daemon runs", async () => {
      const repo = await answering(1_000);
      const { cli, spawns } = spawnLog(suite);
      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(/^Squeal daemon alive for .*\n\n/);
      expect(stdout).not.toMatch(/no daemon|heartbeat is late/);
      expect(spawns()).toHaveLength(0);
    });

    it.each([
      ["the store records no daemon yet", null, /^ {2}no daemon has validated; /m],
      [
        "its heartbeat is late",
        30_000,
        /^ {2}the daemon's heartbeat is late: the last one was 30 s ago/m,
      ],
    ])("says the daemon answered, not alive, while %s", async (_case, ago, daemonLine) => {
      const repo = await answering(ago);
      const { cli, spawns } = spawnLog(suite);
      const { code, stdout, stderr } = await startIn(repo, BOUNDS, cli);
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(/^Squeal daemon answered for .*\n\n/);
      expect(stdout).toMatch(daemonLine);
      expect(stdout).not.toMatch(/Squeal daemon alive/);
      expect(spawns()).toHaveLength(0);
    });
  },
);
