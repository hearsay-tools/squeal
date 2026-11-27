import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { DeskEvents } from "../../src/core/daemon/desk.js";
import type { Held } from "../../src/core/daemon/run-group.js";
import { BUSY_SLICE_MS } from "../../src/core/store/busy.js";
import { isBusy } from "../../src/core/store/connection.js";
import { storePaths } from "../../src/core/store/paths.js";
import { type ThreadLockHolder, threadLockHolder } from "../helpers/busy-store.js";
import { createFixtureRepo, type FixtureRepo, SLOW } from "./helpers.js";

/*
 * Review 0.1.434, B2 (spec 021 D2, row 021-08): a socket request waited
 * for a free store and then made its own write with the store's one wait;
 * a writer that took the lock in between failed it ("database is locked")
 * or stopped the daemon's event loop until it let go. Another thread takes
 * the write lock here as the request's own task takes the scheduler's
 * lock, after any such check: the request is answered once the holder
 * ends, the event loop runs between its tries, and a request still refused
 * when the daemon stops answers with a busy error. The scheduler's own
 * tests cover `squeal retry` and `run --all` (`test/scheduler/busy-requests.test.ts`).
 *
 * Row 011-429: the first case checked the event loop's longest stop
 * against 750 ms of wall time, which a loaded runner broke (755 ms, CI
 * 44838999348). It now checks the order and the counted tries instead:
 * the holder lets go only on a turn of the daemon's event loop after a
 * write it refused, and each write it refused waited at most a slice.
 */

const desk = vi.hoisted(() => ({ events: null as DeskEvents | null }));

vi.mock("../../src/core/daemon/desk.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/desk.js")>();
  return {
    ...actual,
    prepareFrontDesk: (...args: Parameters<typeof actual.prepareFrontDesk>) => {
      const prepared = actual.prepareFrontDesk(...args);
      return {
        ...prepared,
        open: (identity, events) => {
          desk.events = events;
          return prepared.open(identity, events);
        },
      } satisfies typeof prepared;
    },
  };
});

/** A ready daemon of a fresh fixture, stopped after the test. */
async function ready(): Promise<{ repo: FixtureRepo; stop: () => Promise<unknown> }> {
  const repo = createFixtureRepo();
  onTestFinished(repo.cleanup);
  const daemon = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;
  return { repo, stop: () => daemon.stop("stop-requested") };
}

/**
 * A holder of `database`'s write lock that lets go only when `release`
 * is called, on this thread's event loop; ended with the test. Its
 * worker gives up after `ceilingMs` only so a stopped loop fails the case
 * instead of hanging it.
 */
function loopReleasedHolder(database: string, ceilingMs = 60_000) {
  const flags = new Int32Array(new SharedArrayBuffer(16));
  const worker = new Worker(
    `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const flags = new Int32Array(workerData.flags);
Atomics.wait(flags, 0, 0);
const db = new DatabaseSync(workerData.database);
db.exec("BEGIN IMMEDIATE");
Atomics.store(flags, 1, 1);
Atomics.notify(flags, 1);
Atomics.wait(flags, 3, 0, workerData.ceilingMs);
db.exec("ROLLBACK");
db.close();
Atomics.store(flags, 2, 1);
`,
    { eval: true, workerData: { database, ceilingMs, flags: flags.buffer } },
  );
  const release = () => {
    Atomics.store(flags, 3, 1);
    Atomics.notify(flags, 3);
  };
  onTestFinished(async () => {
    release();
    await worker.terminate();
  });
  return {
    take() {
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      Atomics.wait(flags, 1, 0, 5_000);
    },
    release,
    get taken() {
      return Atomics.load(flags, 1) === 1;
    },
    get released() {
      return Atomics.load(flags, 2) === 1;
    },
  };
}

/**
 * The busy timeout each `BEGIN IMMEDIATE` of this thread that a busy store
 * refused ran with, from the `PRAGMA busy_timeout` its connection last set;
 * `NaN` where none was set, which no bound passes. The holder's worker
 * thread is not seen.
 */
function refusedBegins(): number[] {
  const exec = DatabaseSync.prototype.exec;
  const timeouts = new WeakMap<DatabaseSync, number>();
  const refused: number[] = [];
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const set = /^PRAGMA busy_timeout = (\d+)$/.exec(sql);
    if (set !== null) timeouts.set(this, Number(set[1]));
    try {
      return exec.call(this, sql);
    } catch (error) {
      if (sql === "BEGIN IMMEDIATE" && isBusy(error))
        refused.push(timeouts.get(this) ?? Number.NaN);
      throw error;
    }
  });
  onTestFinished(() => spy.mockRestore());
  return refused;
}

/**
 * `held` for a `squeal run <group>` request (row 011-302): told each holder
 * of the scheduler's lock, at once before its task runs, it takes
 * `holder`'s lock when the request's own task takes the scheduler's, after
 * any check the daemon made before.
 */
function takeWhenHeld(holder: Pick<ThreadLockHolder, "take" | "taken">, group: string): Held {
  const operation = `taking a squeal run ${group} request`;
  return (by) => {
    if (!holder.taken && by?.kind === "scheduler" && by.operation === operation) holder.take();
  };
}

describe("a socket request whose own write meets a busy store (review 0.1.434 B2)", SLOW, () => {
  it("answers squeal run tests once the holder ends, the event loop running meanwhile", async () => {
    // Before the daemon opens its store, so the spy sees each connection's busy timeout.
    const refused = refusedBegins();
    const { repo } = await ready();
    const request = desk.events?.requestGroup;
    if (request === undefined) throw new Error("the daemon's desk takes no squeal run <group>");
    const holder = loopReleasedHolder(storePaths(repo.commonDir).database);
    // A turn of the event loop after a refused write is what lets the holder go:
    // a request that stopped the loop until the lock was free never sees it free.
    const turns = setInterval(() => {
      if (refused.length > 0) holder.release();
    }, 10);
    onTestFinished(() => clearInterval(turns));

    const answer = request("tests", takeWhenHeld(holder, "tests"));

    expect(await answer).toMatchObject({ queued: expect.any(Number) });
    expect(holder.taken).toBe(true);
    expect(holder.released).toBe(true);
    expect(refused.length).toBeGreaterThan(0);
    // Each try waited at most a slice, so the loop never stopped longer (spec 021 D2).
    for (const timeoutMs of refused) expect(timeoutMs).toBeLessThanOrEqual(BUSY_SLICE_MS);
  });

  it("answers a request still refused when the daemon stops with a busy error", async () => {
    const { repo, stop } = await ready();
    const request = desk.events?.requestGroup;
    if (request === undefined) throw new Error("the daemon's desk takes no squeal run <group>");
    // Held past the stop and the shutdown's own tries.
    const holder = threadLockHolder(storePaths(repo.commonDir).database, 30_000);

    const answer = request("tests", takeWhenHeld(holder, "tests"));
    await expect.poll(() => holder.taken).toBe(true);
    void stop();

    await expect(answer).rejects.toThrow(/the store was still busy when the daemon stopped/);
    expect(holder.released).toBe(false);
  });
});
