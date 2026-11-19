import { describe, expect, it } from "vitest";
import {
  BatchOwner,
  type Instance,
  type OwnedJob,
  type OwnerPorts,
  type WriteState,
} from "../../src/core/store-process/owner.js";

/*
 * Spec 021 D22.4 as amended 2026-11-19 (row 021-36 rebuild): one owner per
 * batch, against a fake store process and a fake clock.
 */

const TIMING = { hungMs: 2_000, boundMs: 1_000, pauseMs: 30_000, startEveryMs: 30_000 };
const ONE: Instance = { pid: 101, startedAt: 1 };

const job = (n: number, conn = 1, epoch = 0): OwnedJob => ({
  n,
  seq: `s${n}`,
  kind: "record",
  splittable: false,
  statements: [{ sql: "INSERT INTO t VALUES (?)", params: [n] }],
  conn,
  epoch,
});

const busy = () =>
  Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 });

/** A store process and SQLite as a test sets them: what each port does, and what it was asked. */
class World implements OwnerPorts {
  clock = 0;
  free = false;
  /** `null`: no answer (stopped or starting). */
  answering: Instance | null = ONE;
  /** What the store process answers a write; `lost`: no answer. */
  onSubmit: (j: OwnedJob) => { id: string; state: WriteState } | { refused: string } | "lost" =
    () => ({ id: "r", state: { written: true, error: null } });
  onStatus: (id: string) => WriteState | "unknown" | "lost" = () => ({
    written: true,
    error: null,
  });
  /** The mark: batches the store process committed. */
  readonly committed = new Set<string>();
  /** SQLite's lock, held by another process until this time. */
  lockedUntil = 0;
  readonly here: string[] = [];
  readonly killed: number[] = [];
  starts = 0;
  submits = 0;

  lockFree = () => this.free;
  start = () => {
    this.starts++;
  };
  ping = async () => this.answering;
  submit = async (j: OwnedJob) => {
    this.submits++;
    return this.onSubmit(j);
  };
  status = async (id: string) => this.onStatus(id);
  holder = () => null;
  kill = (pid: number) => {
    this.killed.push(pid);
    this.answering = null;
    this.free = true;
  };
  direct = (j: OwnedJob) => {
    if (this.clock < this.lockedUntil) throw busy();
    if (this.committed.has(j.seq)) return "superseded" as const;
    this.here.push(j.seq);
    this.committed.add(j.seq);
    return "written" as const;
  };
  sleep = async (ms: number) => {
    this.clock += ms;
  };
  now = () => this.clock;
}

describe("one owner per batch (spec 021 D22.4, row 021-36)", () => {
  it("writes here when the store process's lock is free, and starts one", async () => {
    const world = new World();
    world.free = true;
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "here", why: "none" });
    expect(await owner.settle(job(2))).toEqual({ by: "here", why: "none" });
    expect(world.here).toEqual(["s1", "s2"]);
    // At most one start per pause.
    expect(world.starts).toBe(1);
  });

  it("leaves a batch to a store process that answers, however long it takes", async () => {
    const world = new World();
    let asked = 0;
    world.onSubmit = () => ({ id: "r", state: { written: null, error: null } });
    // Written after 60 s of waiting: slow, never written here.
    world.onStatus = () => {
      asked++;
      return { written: world.clock >= 60_000 ? true : null, error: null };
    };
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "store", marked: false });
    expect(world.here).toEqual([]);
    expect(world.killed).toEqual([]);
    expect(asked).toBeGreaterThan(100);
  });

  it("counts a committed batch whose answer was lost once, as the store process's (review B5)", async () => {
    const world = new World();
    // The store process commits, then the answer is lost; asked again, it finds the mark.
    world.onSubmit = (j) => {
      if (world.committed.has(j.seq)) return { id: "r2", state: { written: true, error: null } };
      world.committed.add(j.seq);
      return "lost";
    };
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "store", marked: false });
    expect(world.here).toEqual([]);

    // The process died after its commit: the mark found here says it was the store process's.
    world.onSubmit = (j) => {
      world.committed.add(j.seq);
      world.answering = null;
      world.free = true;
      return "lost";
    };
    expect(await owner.settle(job(2))).toEqual({ by: "store", marked: true });
    expect(world.here).toEqual([]);
  });

  it("ends a store process that answers no ping past the bound, then writes the batch here once", async () => {
    const world = new World();
    world.onSubmit = () => {
      world.answering = null;
      return "lost";
    };
    const owner = new BatchOwner(world, TIMING);
    const settled = await owner.settle(job(1));
    expect(settled).toEqual({ by: "here", why: "hung" });
    expect(world.killed).toEqual([ONE.pid]);
    expect(world.clock).toBeGreaterThanOrEqual(TIMING.hungMs);
    expect(world.here).toEqual(["s1"]);
  });

  it("fails a batch busy only when nobody else can write it, past D1's bound (review B2)", async () => {
    const world = new World();
    world.onSubmit = () => {
      world.answering = null;
      return "lost";
    };
    // Another process holds SQLite's lock for 31 s: the stopped store process is ended, then busy.
    world.lockedUntil = 31_000;
    const owner = new BatchOwner(world, TIMING);
    const first = await owner.settle(job(1));
    expect(first).toMatchObject({ busy: true });
    expect(world.killed).toEqual([ONE.pid]);
    // The caller retries with a new batch once the lock is free: one row.
    world.clock = 31_000;
    expect(await owner.settle(job(2, 1, 1))).toEqual({ by: "here", why: "none" });
    expect(world.committed).toEqual(new Set(["s2"]));
  });

  it("sends a batch the store process failed busy again within the bound, never writes it here", async () => {
    const world = new World();
    let tries = 0;
    world.onSubmit = () => {
      tries++;
      return {
        id: "r",
        state:
          tries < 3
            ? { written: false, error: "Error: database is locked" }
            : { written: true, error: null },
      };
    };
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "store", marked: false });
    expect(tries).toBe(3);
    expect(world.here).toEqual([]);
  });

  it("fails a batch its store process rolled back for a reason not busy, unwritten", async () => {
    const world = new World();
    world.onSubmit = () => ({
      id: "r",
      state: { written: false, error: "Error: no such table: x" },
    });
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ failed: "Error: no such table: x", busy: false });
    expect(world.here).toEqual([]);
  });

  it("writes here what the store process refused for its schema, and does not ask for a while", async () => {
    const world = new World();
    world.onSubmit = () => ({ refused: "the daemon's store is at schema 30, not 29" });
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "here", why: "refused" });
    expect(await owner.settle(job(2))).toEqual({ by: "here", why: "refused" });
    expect(world.submits).toBe(1);
  });

  it("waits out a stopping store process, then writes the batch where it can", async () => {
    const world = new World();
    let refusals = 0;
    world.onSubmit = () => {
      if (++refusals === 3) world.free = true;
      return { refused: "the store process is stopping" };
    };
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1))).toEqual({ by: "here", why: "refused" });
    expect(world.here).toEqual(["s1"]);
  });

  it("fails the rest of a connection's epoch after a failed batch, unwritten, and not other connections'", async () => {
    const world = new World();
    world.free = true;
    world.lockedUntil = 5_000;
    const owner = new BatchOwner(world, TIMING);
    expect(await owner.settle(job(1, 1, 0))).toMatchObject({ busy: true });
    world.lockedUntil = 0;
    // Sent before its caller heard of the failure: it followed from rows that failure left out.
    expect(await owner.settle(job(2, 1, 0))).toMatchObject({ busy: true });
    expect(await owner.settle(job(3, 2, 0))).toEqual({ by: "here", why: "none" });
    // Sent after the caller heard of it (its epoch moved): written.
    expect(await owner.settle(job(4, 1, 1))).toEqual({ by: "here", why: "none" });
    expect(world.here).toEqual(["s3", "s4"]);
  });
});
