import { setTimeout as sleep } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { storePaths } from "../../src/core/store/paths.js";
import { createFixtureRepo, ping, readNotes, SLOW, withStore } from "./helpers.js";

/*
 * Spec 021 D2 (row 021-08): the baseline's last commit waited the start's
 * one busy timeout, up to 120 s, in SQLite's busy handler: the daemon's
 * event loop stopped, so its socket answered nothing and no heartbeat ran
 * until the holder ended. Now each try waits a slice and the commit is
 * tried again. Another thread takes the store's write lock as that commit
 * begins and holds it for several slices; the daemon answers its socket
 * while the commit waits, commits once the holder ends, and notes the wait.
 */

const HOLD_MS = 1_500;

/** Waits for a go, then holds the store's write lock `holdMs` on its own event loop. */
const HOLDER = `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const flags = new Int32Array(workerData.flags);
Atomics.wait(flags, 0, 0);
const db = new DatabaseSync(workerData.database);
db.exec("BEGIN IMMEDIATE");
Atomics.store(flags, 1, 1);
Atomics.notify(flags, 1);
setTimeout(() => {
  db.exec("ROLLBACK");
  db.close();
  Atomics.store(flags, 2, 1);
}, workerData.holdMs);
`;

/** A lock holder another thread runs: `take` holds the lock before it returns, as a write needs it. */
function lockHolder(database: string): {
  take(): void;
  readonly taken: boolean;
  readonly released: boolean;
} {
  const flags = new Int32Array(new SharedArrayBuffer(12));
  const worker = new Worker(HOLDER, {
    eval: true,
    workerData: { database, holdMs: HOLD_MS, flags: flags.buffer },
  });
  onTestFinished(async () => {
    await worker.terminate();
  });
  return {
    take() {
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      Atomics.wait(flags, 1, 0, 5_000);
    },
    get taken() {
      return Atomics.load(flags, 1) === 1;
    },
    get released() {
      return Atomics.load(flags, 2) === 1;
    },
  };
}

describe("the baseline's last commit on a busy store (spec 021 D2)", SLOW, () => {
  it("answers the socket while it waits and commits once the holder ends", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const holder = lockHolder(storePaths(repo.commonDir).database);
    const commit = Ledger.prototype.commit;
    const spy = vi.spyOn(Ledger.prototype, "commit").mockImplementation(function (
      this: Ledger,
      ...args: Parameters<Ledger["commit"]>
    ) {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 50;
      const stack = new Error().stack ?? "";
      Error.stackTraceLimit = limit;
      // The baseline's last commit: not the first lookup's (`commitFirst`, row 011-227).
      if (!holder.taken && stack.includes("at baseline") && !stack.includes("commitFirst")) {
        holder.take();
      }
      return commit.apply(this, args);
    });
    onTestFinished(() => spy.mockRestore());

    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await expect.poll(() => holder.taken, { timeout: 60_000 }).toBe(true);
    const answered: string[] = [];
    while (!holder.released) {
      const pong = await ping(repo.socketPath, 300);
      if (pong !== null && !holder.released) answered.push(pong.phase);
      await sleep(50);
    }
    await daemon.ready;

    expect(answered.length).toBeGreaterThan(0);
    expect(answered).toContain("starting");
    const keyed = withStore(repo, (store) =>
      store.testFileKeys.list(repo.worktreeId).filter((row) => row.key !== null),
    );
    expect(keyed.length).toBeGreaterThan(0);
    expect(readNotes(repo).join("\n")).toMatch(/ran once it was free: .*the start's lookup/);
  });
});
