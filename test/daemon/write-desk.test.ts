import { describe, expect, it } from "vitest";
import { encodeBatch } from "../../src/core/daemon/write-batch.js";
import { LEASE_TTL_MS, WriteDesk } from "../../src/core/daemon/write-desk.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { DaemonResponse } from "../../src/core/types/daemon.js";
import type { LeaseProcess, SentBatch, WriteRequest } from "../../src/core/types/daemon-writes.js";

/*
 * Spec 021 D15 (row 021-16): the socket's side of sent writes. The lease
 * stands in for SQLite's write lock between clients; a token is good only
 * for the worktree whose daemon issued it (the coordinator, 2026-11-11).
 */

const ID = "aaaaaaaaaaaaaaaa" as WorktreeId;
const OTHER = "bbbbbbbbbbbbbbbb" as WorktreeId;
const BATCH = encodeBatch([{ sql: "DELETE FROM meta WHERE key = ?", params: ["k"] }]);

function desk(
  options: {
    schema?: number;
    write?: (batch: SentBatch) => Promise<void>;
    alive?: (holder: LeaseProcess) => boolean | null;
  } = {},
) {
  let now = 1_000;
  const written: SentBatch[] = [];
  const pending: (() => void)[] = [];
  const d = new WriteDesk({
    worktreeId: ID,
    storeSchema: options.schema ?? 7,
    now: () => now,
    ...(options.alive === undefined ? {} : { alive: options.alive }),
    requestWrite:
      options.write ??
      ((batch) =>
        new Promise<void>((resolve) => {
          written.push(batch);
          pending.push(resolve);
        })),
  });
  return {
    d,
    written,
    advance: (ms: number) => {
      now += ms;
    },
    settle: async () => {
      for (const resolve of pending.splice(0)) resolve();
      await new Promise((r) => setImmediate(r));
    },
  };
}

const lease = (d: WriteDesk, worktreeId = ID, holder = "1 hook") =>
  d.answer({ type: "lease", worktreeId, holder }, "ready");

const write = (d: WriteDesk, overrides: Partial<WriteRequest> = {}) =>
  d.answer(
    {
      type: "write",
      worktreeId: ID,
      storeSchema: 7,
      token: null,
      release: false,
      batch: BATCH,
      ...overrides,
    },
    "ready",
  );

function tokenOf(answer: DaemonResponse): string {
  if (!answer.ok || answer.type !== "lease" || answer.token === null) throw new Error("no lease");
  return answer.token;
}

describe("the write lease (021-16)", () => {
  it("gives one holder at a time, names it to the next, and ends at release", () => {
    const { d } = desk();
    const token = tokenOf(lease(d, ID, "1 first"));
    expect(lease(d, ID, "2 second")).toMatchObject({ ok: true, token: null, holder: "1 first" });
    expect(d.answer({ type: "release", worktreeId: ID, token }, "ready")).toMatchObject({
      ok: true,
    });
    expect(tokenOf(lease(d, ID, "2 second"))).not.toBe(token);
  });

  it("ends after its time with no write, and a write under it renews it", async () => {
    const t = desk();
    const token = tokenOf(lease(t.d));
    t.advance(LEASE_TTL_MS - 1);
    write(t.d, { token });
    await t.settle();
    t.advance(LEASE_TTL_MS - 1);
    expect(lease(t.d)).toMatchObject({ token: null });
    t.advance(1);
    expect(tokenOf(lease(t.d))).not.toBe(token);
  });

  it("lasts while a write under it waits on a busy store, past its time, and a release ends it after", async () => {
    const t = desk();
    const token = tokenOf(lease(t.d));
    write(t.d, { token, release: true });
    t.advance(LEASE_TTL_MS * 3);
    expect(lease(t.d)).toMatchObject({ token: null });
    await t.settle();
    expect(lease(t.d)).toMatchObject({ token: expect.any(String) });
  });

  it("refuses a lease, a release or a write for another worktree", () => {
    const { d } = desk();
    const token = tokenOf(lease(d));
    const refused = { ok: false, error: `this daemon serves worktree ${ID}, not ${OTHER}` };
    expect(lease(d, OTHER)).toMatchObject(refused);
    expect(d.answer({ type: "release", worktreeId: OTHER, token }, "ready")).toMatchObject(refused);
    expect(write(d, { worktreeId: OTHER, token })).toMatchObject(refused);
  });

  it("refuses a token this daemon never issued", () => {
    const { d } = desk();
    lease(d);
    expect(write(d, { token: "forged" })).toMatchObject({
      ok: false,
      error: "unknown lease token",
    });
    expect(d.answer({ type: "release", worktreeId: ID, token: "forged" }, "ready")).toMatchObject({
      ok: false,
      error: "unknown lease token",
    });
  });

  it("still writes a batch decided under a lease that ended: its client told its host", async () => {
    const t = desk();
    const token = tokenOf(lease(t.d));
    t.advance(LEASE_TTL_MS);
    tokenOf(lease(t.d, ID, "2 next"));
    expect(write(t.d, { token })).toMatchObject({ ok: true, written: null });
    expect(t.written).toHaveLength(1);
  });

  it("refuses a batch read at another store schema", () => {
    const { d, written } = desk({ schema: 8 });
    expect(write(d)).toMatchObject({
      ok: false,
      error: "the daemon's store is at schema 8, not 7",
    });
    expect(written).toEqual([]);
  });

  it("takes no lease or write while the daemon stops, so the client writes itself", () => {
    const { d, written } = desk();
    expect(d.answer({ type: "lease", worktreeId: ID, holder: "h" }, "stopping")).toMatchObject({
      ok: false,
      error: "daemon is stopping",
    });
    const request = {
      type: "write",
      worktreeId: ID,
      storeSchema: 7,
      token: null,
      release: false,
      batch: BATCH,
    } as const;
    expect(d.answer(request, "stopping")).toMatchObject({ ok: false });
    expect(written).toEqual([]);
  });

  it("answers a write's state: waiting, then written, or failed with why", async () => {
    let fail = false;
    const { d } = desk({
      write: async () => {
        if (fail) throw new Error("UNIQUE constraint failed: consumers.id");
      },
    });
    const first = write(d);
    if (!first.ok || first.type !== "write") throw new Error("no write");
    expect(first.written).toBeNull();
    await new Promise((r) => setImmediate(r));
    expect(d.answer({ type: "write-status", requestId: first.requestId }, "ready")).toMatchObject({
      written: true,
      error: null,
    });
    fail = true;
    const second = write(d);
    if (!second.ok || second.type !== "write") throw new Error("no write");
    await new Promise((r) => setImmediate(r));
    expect(d.answer({ type: "write-status", requestId: second.requestId }, "ready")).toMatchObject({
      written: false,
      error: "UNIQUE constraint failed: consumers.id",
    });
  });
});

describe("a lease's process (review 0.1.442 B3)", () => {
  const PROCESS: LeaseProcess = { pid: 4242, startTime: 7, pidNamespace: "pid:[1]" };
  const leaseFor = (d: WriteDesk, holder: string, process?: LeaseProcess) =>
    d.answer(
      { type: "lease", worktreeId: ID, holder, ...(process === undefined ? {} : { process }) },
      "ready",
    );

  it("keeps a lease past its time while its process lives, and ends it once the process is gone", () => {
    let alive = true;
    const asked: LeaseProcess[] = [];
    const t = desk({
      alive: (holder) => {
        asked.push(holder);
        return alive;
      },
    });
    const token = tokenOf(leaseFor(t.d, "1 paused hook", PROCESS));
    t.advance(LEASE_TTL_MS * 4);
    expect(leaseFor(t.d, "2 next hook", PROCESS)).toMatchObject({
      token: null,
      holder: "1 paused hook",
    });
    expect(asked).toEqual([PROCESS]);
    alive = false;
    t.advance(LEASE_TTL_MS - 1);
    // Asked again only once its time passed again.
    expect(leaseFor(t.d, "2 next hook")).toMatchObject({ token: null });
    expect(asked).toHaveLength(1);
    t.advance(1);
    expect(tokenOf(leaseFor(t.d, "2 next hook"))).not.toBe(token);
  });

  it("ends a lease past its time when its process cannot be told, as one with no process", () => {
    const t = desk({ alive: () => null });
    tokenOf(leaseFor(t.d, "1 hook", PROCESS));
    t.advance(LEASE_TTL_MS);
    tokenOf(leaseFor(t.d, "2 hook"));
    t.advance(LEASE_TTL_MS);
    expect(leaseFor(t.d, "3 hook")).toMatchObject({ token: expect.any(String) });
  });

  it("names a held lease's holder to a stopping daemon's client, which then waits, not writes", () => {
    const { d } = desk({ alive: () => true });
    const token = tokenOf(leaseFor(d, "1 telling hook", PROCESS));
    const asked = { type: "lease", worktreeId: ID, holder: "2 hook" } as const;
    expect(d.answer(asked, "stopping")).toMatchObject({
      ok: true,
      token: null,
      holder: "1 telling hook",
    });
    d.answer({ type: "release", worktreeId: ID, token }, "stopping");
    expect(d.answer(asked, "stopping")).toMatchObject({ ok: false, error: "daemon is stopping" });
  });
});
