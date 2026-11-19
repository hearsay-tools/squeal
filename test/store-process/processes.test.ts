import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
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
 * that start the store process at once start one; a batch whose store
 * process was killed is written once; a store process refuses batches of
 * an older schema and stops once its last client left on purpose.
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

/** A wait on an event of a process started from the sources: generous for a slow CI runner. */
const SLOW_MS = 120_000;

describe("the store process as a process (row 021-36)", () => {
  it(
    "starts once when two daemons start it at once",
    async () => {
      const at = fresh();
      const pids = [
        spawnStoreProcess(at.commonDir, LAUNCH, at.env),
        spawnStoreProcess(at.commonDir, LAUNCH, at.env),
      ];
      for (const pid of pids) expect(pid).not.toBeNull();
      at.later(async () => {
        for (const pid of pids) if (pid !== null && alive(pid)) process.kill(pid, "SIGTERM");
        await until(() => pids.every((pid) => pid === null || !alive(pid)), SLOW_MS);
      });

      // Each loads the whole CLI from the sources: on a slow runner that takes long (CI, Node 22).
      const socket = storeProcessSocketPath(at.commonDir, "code", at.env);
      await until(() => existsSync(socket), SLOW_MS);
      // The one that did not take the lock exits at once; the other serves.
      await until(() => pids.filter((pid) => pid !== null && alive(pid)).length === 1, SLOW_MS);
      const one = relay(at, "w1");
      const store = openThrough(at, one);
      await until(() => {
        store.meta.set("k", "v");
        return one.counts.sent > 0;
      }, SLOW_MS);
      // It served a batch, and still only one runs.
      expect(pids.filter((pid) => pid !== null && alive(pid))).toHaveLength(1);
    },
    4 * SLOW_MS,
  );

  it("writes a batch its store process was killed in once: by the store process (its mark) or here", async () => {
    const at = fresh();
    const running = await storeProcess(at);
    const one = relay(at, "w1");
    const store = openThrough(at, one, 10_000);
    await warm(one, store);

    const rows = 300_000;
    store.transaction(() => {
      for (let i = 0; i < rows; i++) store.meta.set(`big:${i}`, "x");
    });
    // While the store process writes it, or before or after: each is written once.
    await new Promise((resolve) => setTimeout(resolve, 400));
    process.kill(running.pid, "SIGKILL");
    await store.sent();

    expect(await running.ended).toBe("exit SIGKILL");
    const db = plain(at);
    const count = db.prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'big:%'").get();
    expect(count).toEqual({ n: rows });
    expect(db.prepare("SELECT value FROM meta WHERE key = ?").get(markKey("w1"))).toBeDefined();
    // Written once: by the store process before it died (the mark said so), or here.
    expect(one.counts.sent + one.counts.direct).toBe(1);
    expect(one.counts.failed).toBe(0);

    // With no store process, the next batches are written here at once.
    const here = one.counts.direct;
    store.meta.set("after", "1");
    await store.sent();
    expect(store.meta.get("after")).toBe("1");
    expect(one.counts.direct).toBe(here + 1);
  }, 60_000);

  // Review of 0.1.571, R1 N1: a leaving release that came while its write waited was forgotten.
  it("stops once the write of its last client, who left on purpose while it waited, settled", async () => {
    const at = fresh();
    const running = await storeProcess(at, { checkMs: 25 });
    const socket = storeProcessSocketPath(at.commonDir, "code", at.env);
    const lease = await requestDaemon(
      socket,
      { type: "lease", worktreeId: "w1", holder: "test", process: leaseProcess() },
      2_000,
    );
    if (!lease.ok || lease.type !== "lease" || lease.token === null) throw new Error("no lease");
    const holder = await holdLock(at, 600);
    const write = await requestDaemon(
      socket,
      {
        type: "write",
        worktreeId: "w1",
        storeSchema: CODE_SCHEMA_VERSION,
        token: lease.token,
        release: false,
        seq: batchSeq(1, 1),
        batch: encodeBatch([
          { sql: "INSERT INTO meta (key, value) VALUES ('n1', 'x')", params: [] },
        ]),
      },
      2_000,
    );
    expect(write.ok).toBe(true);
    const release = {
      type: "release",
      worktreeId: "w1",
      token: lease.token,
      leaving: true,
    } as const;
    expect((await requestDaemon(socket, release, 2_000)).ok).toBe(true);
    await holder.done;

    expect(await running.ended).toBe("stopped");
    const db = new DatabaseSync(join(at.commonDir, "squeal", "code.sqlite"));
    at.later(() => db.close());
    expect(db.prepare("SELECT value FROM meta WHERE key = 'n1'").get()).toEqual({ value: "x" });
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
