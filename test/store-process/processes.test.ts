import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { encodeBatch } from "../../src/core/daemon/write-batch.js";
import { batchSeq, markKey } from "../../src/core/store-process/guard.js";
import { storeProcessSocketPath } from "../../src/core/store-process/paths.js";
import { spawnStoreProcess } from "../../src/core/store-process/spawn.js";
import {
  alive,
  type Clone,
  clone,
  holdLock,
  LAUNCH,
  openThrough,
  plain,
  relay,
  storeProcess,
  until,
  warm,
} from "./helpers.js";

/*
 * Spec 021 D22.2 and D22.4 (row 021-36), with real processes: two daemons
 * that start the store process at once start one, and a store process
 * killed in the middle of a batch leaves its client to write the batch
 * itself within D1's bound, once.
 */

const clones: Clone[] = [];
afterEach(async () => {
  for (const at of clones.splice(0)) await at.cleanup();
});
const fresh = () => {
  const at = clone();
  clones.push(at);
  return at;
};

describe("the store process as a process (row 021-36)", () => {
  it("starts once when two daemons start it at once", async () => {
    const at = fresh();
    const pids = [
      spawnStoreProcess(at.commonDir, LAUNCH, at.env),
      spawnStoreProcess(at.commonDir, LAUNCH, at.env),
    ];
    for (const pid of pids) expect(pid).not.toBeNull();
    at.later(async () => {
      for (const pid of pids) if (pid !== null && alive(pid)) process.kill(pid, "SIGTERM");
      await until(() => pids.every((pid) => pid === null || !alive(pid)), 10_000);
    });

    const socket = storeProcessSocketPath(at.commonDir, "code", at.env);
    await until(() => existsSync(socket), 30_000);
    // The one that did not take the lock exits at once; the other serves.
    await until(() => pids.filter((pid) => pid !== null && alive(pid)).length === 1, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(pids.filter((pid) => pid !== null && alive(pid))).toHaveLength(1);

    const one = relay(at, "w1");
    const store = openThrough(at, one);
    await until(() => {
      store.meta.set("k", "v");
      return one.counts.sent > 0;
    }, 10_000);
  }, 60_000);

  it("leaves a batch it was killed in to the client, written once within the bound", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 10_000);
    await warm(one, store);

    const rows = 300_000;
    // The test's thread waits inside the batch, so the kill comes from a shell started before it.
    const killer = spawn("sh", ["-c", `sleep 0.4; kill -9 ${running.pid}`], { stdio: "ignore" });
    const started = performance.now();
    store.transaction(() => {
      for (let i = 0; i < rows; i++) store.meta.set(`big:${i}`, "x");
    });
    const took = performance.now() - started;
    await new Promise((resolve) => killer.on("exit", resolve));

    expect(await running.ended).toBe("exit SIGKILL");
    expect(took).toBeLessThan(10_000);
    const db = plain(at);
    const count = db.prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'big:%'").get();
    expect(count).toEqual({ n: rows });
    expect(db.prepare("SELECT value FROM meta WHERE key = ?").get(markKey("w1"))).toBeDefined();
    // Written once: by the store process before it died (the mark said so), or here.
    expect(one.counts.direct + one.counts.superseded).toBe(1);
    expect(one.counts.sent).toBe(0);

    // With no store process, the next batches are written here at once.
    store.meta.set("after", "1");
    expect(store.meta.get("after")).toBe("1");
    expect(one.counts.direct + one.counts.superseded).toBe(2);
  }, 60_000);

  // Review of 0.1.571 B2: the trace that lost a batch, now settled by its mark before the next.
  it("settles a batch a stopped store process holds before a later batch passes it", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 200);
    await warm(one, store);
    process.kill(running.pid, "SIGSTOP");
    at.later(() => {
      if (alive(running.pid)) process.kill(running.pid, "SIGCONT");
    });

    const holder = await holdLock(at, 600);
    // No answer from the stopped process: written here under its mark once the lock frees.
    store.meta.set("first", "1");
    await holder.done;
    store.meta.set("second", "2");
    process.kill(running.pid, "SIGCONT");
    await until(() => {
      store.meta.set("barrier", "1");
      return one.counts.sent > 0;
    }, 20_000);

    expect(store.meta.get("first")).toBe("1");
    expect(store.meta.get("second")).toBe("2");
    expect(one.counts.failed).toBe(0);
    expect(one.counts.fallback.lost).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // Review of 0.1.571 B3: old-schema batches are refused once the file's schema moved on.
  it("refuses old-schema batches when a newer schema arrives, and stops", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const socket = storeProcessSocketPath(at.commonDir, "code", at.env);
    const write = (seq: string, key: string, schema = CODE_SCHEMA_VERSION) =>
      requestDaemon(
        socket,
        {
          type: "write",
          worktreeId: "w1",
          storeSchema: schema,
          token: null,
          release: false,
          seq,
          batch: encodeBatch([
            { sql: "INSERT INTO meta (key, value) VALUES (?, ?)", params: [key, "x"] },
          ]),
        },
        2_000,
      );
    const holder = await holdLock(at, 800, CODE_SCHEMA_VERSION + 1);
    expect((await write(batchSeq(1, 1), "one")).ok).toBe(true);
    expect((await write(batchSeq(1, 2), "two")).ok).toBe(true);
    expect((await write(batchSeq(1, 3), "three", CODE_SCHEMA_VERSION + 1)).ok).toBe(false);
    await holder.done;

    expect(await running.ended).toBe("newer-schema");
    const db = new DatabaseSync(join(at.commonDir, "squeal", "code.sqlite"));
    at.later(() => db.close());
    expect(db.prepare("SELECT key FROM meta WHERE key IN ('one', 'two', 'three')").all()).toEqual(
      [],
    );
    expect(running.stderr()).toMatch(/is at schema \d+, not \d+/);
  }, 60_000);
});
