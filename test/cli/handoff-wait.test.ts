import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { namedLine, waitLine } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { claimHandoff, handoffFrom } from "../../src/core/delivery/handoff.js";
import { appendNote } from "../../src/core/notes.js";
import { lockFileFor } from "../../src/core/store/index.js";
import {
  type DaemonRecord,
  daemonExitMetaKey,
  type EpochMs,
  type WorktreeId,
} from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Row 011-34 (011 C9 as amended 2026-10-20, design 011-30 section 4): a
 * wait whose daemon is stopping says it hands over, never that its
 * heartbeat lapsed; past the handoff's bound it returns without a daemon and
 * names `squeal start`. The probe's wait said the heartbeat "went 146 s
 * stale while its socket showed it alive (a busy store or a stalled daemon)".
 */

const saved = { ...process.env };
let runtimeDir: string;
const releases: (() => void)[] = [];

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const unsupported = (): DaemonSync => ({
  current: () => ({ state: "unsupported" }),
  stop: () => {},
});

/** Its shutdown began at `SINCE`, when its last heartbeat was; a hook claimed the handoff then. */
const SINCE = (NOW - 20_000) as EpochMs;
/** The wait's bound: the interval after that heartbeat, then the handoff's 130 s. */
const BOUND = SINCE + 5_000 + 130_000;
const STOPPING = {
  ok: true,
  type: "ping",
  pid: 4242,
  squealVersion: "0.1.0",
  phase: "stopping",
  startedAt: NOW - 600_000,
};

/** A queued slow file, and a 0.1.0 daemon that steps down to 0.1.31 holding its lock. */
async function handingOver() {
  const { repo, store } = repoWith([SLOW_FILE]);
  const id = repo.mainId as WorktreeId;
  const record: DaemonRecord = {
    socketPath: socketPathFor(id),
    startedAt: STOPPING.startedAt as EpochMs,
    heartbeatAt: SINCE,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.1.0",
    token: "old",
  };
  store.worktrees.setDaemon(id, record);
  const self = handoffFrom(record);
  store.meta.set(daemonExitMetaKey(id), self);
  appendNote(store, id, { at: SINCE, revision: 4, text: "daemon stepped down", exitOf: self });
  claimHandoff(store, id, { from: self, to: "0.1.31", at: SINCE });
  const lock = acquireDaemonLock(lockFileFor(repo.commonDir, id));
  if (lock === null) throw new Error("the lock is taken");
  releases.push(() => lock.release());
  await fakeDaemon(record.socketPath, { ping: [STOPPING] });
  return { repo, record };
}

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 10));
}

const options = (now: number) => ({
  timeoutMs: 1_500,
  pollMs: 50,
  settleMs: 0,
  now: () => now as EpochMs,
  sync: unsupported,
});

describe("a wait while the daemon hands over (row 011-34)", () => {
  it("goes on until the handoff's bound, then finds no daemon for reason handoff", async () => {
    const { repo, record } = await handingOver();
    const watch = watchDaemon(repo.mainId as WorktreeId);
    expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "lapsed" });
    await until(() => watch.lapse() !== null);
    expect(watch.judge(record, (BOUND - 1) as EpochMs)).toEqual({ state: "lapsed" });
    expect(watch.judge(record, BOUND as EpochMs)).toEqual({ state: "down", reason: "handoff" });
  });

  it("names the handoff in place of a lapse when it ends before the bound", async () => {
    const { repo } = await handingOver();
    const wait = await waitForStatus(repo.main, options(NOW));
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.outcome).toBe("timeout");
    const line = waitLine(wait);
    expect(line).toContain(
      `; the daemon is handing over from 0.1.0 to 0.1.31 since ${new Date(SINCE).toISOString()}, so the wait went on`,
    );
    expect(line).not.toContain("stalled daemon");
  });

  it("returns without a daemon past the bound, naming `squeal start`", async () => {
    const { repo } = await handingOver();
    const wait = await waitForStatus(repo.main, options(BOUND));
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait).toMatchObject({ outcome: "no-daemon", down: "handoff" });
    expect(waitLine(wait)).toMatch(
      /^Returned without a daemon: the handoff to 0\.1\.31 did not finish within 130 s; `squeal start` finishes it; results are as of revision 4\. Worktree: /,
    );
  });

  it("gives a named wait no verdict past the bound, naming `squeal start` once", async () => {
    const { repo } = await handingOver();
    const wait = await waitForNamed(repo.main, [SLOW_FILE], options(BOUND));
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait).toMatchObject({ outcome: "no-daemon", down: "handoff" });
    const line = namedLine(wait);
    expect(line).toMatch(
      /^Named test files have no verdict(?: at revision \d+)?: the handoff to 0\.1\.31 did not finish within 130 s; `squeal start` finishes it/,
    );
    expect(line.match(/squeal start/g)).toHaveLength(1);
  });
});
