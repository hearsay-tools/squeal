import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { encodeBatch } from "../../src/core/daemon/write-batch.js";
import {
  LONG_WRITE_WAIT_MS,
  WRITE_WAIT_SAMPLE_CAP,
  WriteWaitStats,
} from "../../src/core/daemon/write-wait.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { SentBatch } from "../../src/core/types/daemon-writes.js";

/*
 * Spec 025 D9 (row 025-09): how long a hook's write waited for the daemon
 * main thread. Both lines are parsed verbatim by bench/lib.mjs (row 025-08).
 */

const LONG = /^long write wait: hook write waited \d+ ms for the daemon main thread$/;
const SUMMARY = /^hook writes: \d+ taken, queue wait p95 \d+ ms max \d+ ms$/;

function stats(cap?: number) {
  const lines: string[] = [];
  return { lines, stats: new WriteWaitStats((text) => lines.push(text), cap) };
}

describe("WriteWaitStats (025-09)", () => {
  it("logs a wait above 250 ms on its own, and none at or below it", () => {
    const { lines, stats: s } = stats();
    s.record(LONG_WRITE_WAIT_MS);
    s.record(10);
    expect(lines).toEqual([]);
    s.record(312.6);
    expect(lines).toEqual(["long write wait: hook write waited 313 ms for the daemon main thread"]);
    expect(lines[0]).toMatch(LONG);
  });

  it("sums the writes since the last take as count, p95 and max, then resets", () => {
    const { stats: s } = stats();
    expect(s.take()).toBeNull();
    for (let wait = 1; wait <= 100; wait += 1) s.record(wait);
    const line = s.take();
    expect(line).toBe("hook writes: 100 taken, queue wait p95 95 ms max 100 ms");
    expect(line).toMatch(SUMMARY);
    expect(s.take()).toBeNull();
    s.record(4.4);
    expect(s.take()).toBe("hook writes: 1 taken, queue wait p95 4 ms max 4 ms");
  });

  it("keeps at most the cap of samples for the p95, the count and the max exact", () => {
    const { stats: s } = stats(10);
    s.record(200);
    for (let n = 0; n < 50; n += 1) s.record(1);
    // The early 200 ms left the ring, but it is still the max.
    expect(s.take()).toBe("hook writes: 51 taken, queue wait p95 1 ms max 200 ms");
    expect(WRITE_WAIT_SAMPLE_CAP).toBeGreaterThan(0);
  });

  it("reads a negative or non-finite wait as 0", () => {
    const { lines, stats: s } = stats();
    s.record(-5);
    s.record(Number.NaN);
    expect(lines).toEqual([]);
    expect(s.take()).toBe("hook writes: 2 taken, queue wait p95 0 ms max 0 ms");
  });
});

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const REGISTER_TS = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const EXEC_ARGV = ["--disable-warning=ExperimentalWarning", "--import", REGISTER_TS];
const BLOCK_MS = 400;

/**
 * Sends one write to the socket from another thread, so the request goes
 * out while this thread is blocked; sets `done[0]` once it is answered,
 * which the front desk does after posting the write to this thread.
 */
function sendFromThread(socketPath: string, batch: SentBatch, done: Int32Array): Worker {
  const client = pathToFileURL(
    fileURLToPath(new URL("../../src/core/daemon/client.ts", import.meta.url)),
  ).href;
  const source = `
    const { workerData } = require("node:worker_threads");
    import(${JSON.stringify(client)}).then(async ({ requestDaemon }) => {
      const answer = await requestDaemon(workerData.socketPath, workerData.request, 5000);
      Atomics.store(workerData.done, 0, answer.ok ? 1 : 2);
      Atomics.notify(workerData.done, 0);
    });
  `;
  return new Worker(source, {
    eval: true,
    execArgv: EXEC_ARGV,
    workerData: {
      socketPath,
      done,
      request: {
        type: "write",
        worktreeId: "0123456789abcdef",
        storeSchema: 7,
        token: null,
        release: false,
        batch,
      },
    },
  });
}

describe("the front desk stamps a hook write's queue wait (025-09)", () => {
  it("tells the main thread how long the write waited while it was blocked", async () => {
    const dir = mkdtempSync("/tmp/sq-write-wait-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const waits: number[] = [];
    const written: SentBatch[] = [];
    const prepared = prepareFrontDesk({
      script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
      execArgv: EXEC_ARGV,
    });
    const fail = () => Promise.reject(new Error("not in this test"));
    const desk = await prepared.open(
      {
        socketPath,
        worktreeId: "0123456789abcdef" as never,
        root: "/",
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
        token: "t",
        storeSchema: 7,
      },
      {
        onActivity: () => {},
        requestFullSuite: fail,
        requestSlowSuite: fail,
        requestSync: fail,
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
        requestWrite: async (batch) => {
          written.push(batch);
        },
        onWriteWait: (waitMs) => waits.push(waitMs),
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const done = new Int32Array(new SharedArrayBuffer(4));
    const batch = encodeBatch([{ sql: "DELETE FROM meta WHERE key = ?", params: ["k"] }]);
    const client = sendFromThread(socketPath, batch, done);
    cleanups.push(() => client.terminate());
    // Block this thread: first until the desk answered (it posted the write), then BLOCK_MS more.
    expect(Atomics.wait(done, 0, 0, 10_000)).not.toBe("timed-out");
    expect(Atomics.load(done, 0)).toBe(1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);

    await expect.poll(() => written.length).toBe(1);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(BLOCK_MS - 20);
    expect(waits[0]).toBeGreaterThan(LONG_WRITE_WAIT_MS);
  });
});
