import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { HostCpu, TreeCpu } from "../../src/core/capacity/cores.js";
import { type PoolMark, readMarks } from "../../src/core/capacity/marks.js";
import { createPermitPool, type PermitPool } from "../../src/core/capacity/pool.js";
import { QUIET_DEMAND_WRITE_MS, QuietDemand } from "../../src/core/capacity/quiet-demand.js";
import { fairShares } from "../../src/core/capacity/share.js";

/*
 * Row 011-424 (spec 011 C4 step 5 and C10 as amended,
 * `research/simultaneous-demand.md` arm qc): a daemon whose wait for quiet
 * holds backlog states it in its mark as demand with no grant, and a
 * backlog tier's fair share divides the workers the background ceiling
 * admits, not the slots. The lab VM's numbers: 12 CPUs, 11 slots, ceiling
 * 9; the host idles at 0.3 busy CPUs and a running worker uses 0.95.
 */

let root: string;
let dir: string;
let skew: number;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-quiet-demand-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  skew = 0;
  host = {
    cores: 0.3,
    read() {
      return this.cores;
    },
  };
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

/** The pools' clock: the real one, so marks stay fresh, moved on by `later`. */
const now = () => Date.now() + skew;
/** Time passes: each pool reads the host over a new window at its next look. */
const later = (ms = 1_500) => {
  skew += ms;
};

const tree: TreeCpu = { read: () => 0, reset() {} };
/** The host's busy CPUs, which the test sets; each test starts at 0.3. */
let host: HostCpu & { cores: number };

function daemon(id: string, cpus = 12, refreshMs?: number): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: cpus - 1,
    cpus,
    cores: tree,
    host,
    now,
    ...(refreshMs === undefined ? {} : { refreshMs }),
  });
  pools.push(pool);
  return pool;
}

const markOf = (id: string): PoolMark | undefined =>
  readMarks(dir, "reader", now()).find((m) => m.id === id);
/** The one mark file in the pool's directory. */
const markPath = () => {
  const name = readdirSync(dir).find((n) => n.startsWith("pool.mark.") && !n.endsWith(".tmp"));
  if (name === undefined) throw new Error(`no mark in ${dir}`);
  return join(dir, name);
};

/**
 * `asker` asks for a 200-file backlog tier while `quiet`'s wait holds 64
 * files; its tier then runs, and `quiet`'s wait ends: it asks for 64.
 */
function bothStart(asker: PermitPool, quiet: PermitPool | null) {
  quiet?.expectBacklog(64);
  const first = asker.acquire(200, "fast", 1, "backlog");
  host.cores = 0.3 + 0.95 * (first?.grant ?? 0);
  later();
  quiet?.expectBacklog(0);
  const second = quiet?.acquire(64, "fast", 1, "backlog") ?? null;
  return { first: first?.grant ?? 0, second: second?.grant ?? 0 };
}

describe("two daemons whose waits end together share the ceiling (row 011-424)", () => {
  test("the asker gets its fair share of the ceiling, 5 of 9, and the quiet one the rest", () => {
    expect(bothStart(daemon("a"), daemon("b"))).toEqual({ first: 5, second: 4 });
  });

  test("whichever sorts first, the two grants fill the ceiling at 5 and 4", () => {
    const grants = bothStart(daemon("b"), daemon("a"));
    expect(grants.first + grants.second).toBe(9);
    expect([grants.first, grants.second].sort()).toEqual([4, 5]);
  });

  test("one daemon alone gets the whole ceiling, 9", () => {
    expect(bothStart(daemon("a"), null).first).toBe(9);
  });

  test("a ceiling of 7.5 (10 CPUs, 9 slots) admits 8: one alone gets 8, two get 4 and 4", () => {
    expect(bothStart(daemon("a", 10), null).first).toBe(8);
    for (const pool of pools.splice(0)) pool.close();
    host.cores = 0.3;
    expect(bothStart(daemon("a", 10), daemon("b", 10))).toEqual({ first: 4, second: 4 });
  });

  test("a checkpoint tier's share still divides the slots", () => {
    daemon("b").expectBacklog(64);
    // 11 slots for two: 6 for the senior by id; the checkpoint's gate allows them.
    expect(daemon("a").acquire(200, "fast", 1, "checkpoint")?.grant).toBe(6);
  });
});

describe("the quiet's demand in the mark (row 011-424)", () => {
  test("states the held files with no grant, and 0 clears the mark", () => {
    const quiet = daemon("q");
    quiet.expectBacklog(64);
    expect(markOf("q")).toMatchObject({ want: 64, grant: 0, since: null, background: 0 });
    quiet.expectBacklog(0);
    expect(markOf("q")).toBeUndefined();
  });

  test("a tier that asks ends it: its mark states the tier's demand, and its release clears it", () => {
    const quiet = daemon("q");
    quiet.expectBacklog(64);
    const lease = quiet.acquire(20, "fast", 1, "backlog");
    expect(lease?.grant).toBe(9);
    expect(markOf("q")).toMatchObject({ want: 20, grant: 9 });
    lease?.release();
    expect(markOf("q")).toBeUndefined();
  });

  test("an edit's tier that ends keeps the quiet's demand in the mark", () => {
    const quiet = daemon("q");
    quiet.expectBacklog(30);
    const end = quiet.running(4);
    expect(markOf("q")).toMatchObject({ want: 30, grant: 0 });
    end();
    expect(markOf("q")).toMatchObject({ want: 30, grant: 0 });
  });

  test("ended while an edit's tier runs, no refresh of the edit's mark states it again", async () => {
    // Review 0.1.584 B2: the quiet started again under an edit's tier, which runs without a lease.
    const quiet = daemon("q", 12, 10);
    quiet.expectBacklog(6);
    const end = quiet.running(4);
    quiet.expectBacklog(0);
    expect(markOf("q")).toMatchObject({ want: 0, grant: 0 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(markOf("q")).toMatchObject({ want: 0, grant: 0 });
    // A peer is offered the whole ceiling again once the edit's tree is measured idle.
    const peer = daemon("peer");
    await expect.poll(() => peer.offer(9, "fast", "backlog")).toBe(9);
    end();
    expect(markOf("q")).toBeUndefined();
  });

  test("ending it keeps a refused waiter's mark", () => {
    const other = daemon("other");
    const held = other.acquire(11, "fast", 1, "checkpoint");
    const quiet = daemon("q");
    quiet.expectBacklog(10);
    expect(quiet.acquire(4, "fast", 1, "checkpoint")).toBeNull();
    quiet.expectBacklog(10);
    quiet.expectBacklog(0);
    expect(markOf("q")).toMatchObject({ want: 4, grant: 0 });
    held?.release();
  });

  test("an unchanged demand is written again only after 5 s; a changed one at once", () => {
    const quiet = daemon("q");
    quiet.expectBacklog(64);
    const path = markPath();
    const old = new Date(Date.now() - 20_000);
    utimesSync(path, old, old);
    later(QUIET_DEMAND_WRITE_MS - 1_000);
    quiet.expectBacklog(64);
    // The file system may give the time back a fraction of a millisecond off (CI 44850562751).
    expect(Math.abs(statSync(path).mtimeMs - old.getTime())).toBeLessThan(1);
    later(1_000);
    quiet.expectBacklog(64);
    expect(statSync(path).mtimeMs).toBeGreaterThan(old.getTime());
    quiet.expectBacklog(12);
    expect(markOf("q")).toMatchObject({ want: 12 });
  });

  test("an older reader reads it as a holder's demand with no grant", () => {
    daemon("q").expectBacklog(64);
    // The mark's format is unchanged: version 1, and only keys an older release knows.
    const body = JSON.parse(readFileSync(markPath(), "utf8")) as Record<string, unknown>;
    expect(body).toMatchObject({ v: 1, id: "q", want: 64, grant: 0, since: null });
    const known = ["v", "id", "want", "grant", "since", "project", "slow", "least", "cores"];
    expect(Object.keys(body).every((k) => [...known, "background"].includes(k))).toBe(true);
    // An older daemon divides the 11 slots among the marks that want: the quiet one counts.
    const mark = markOf("q");
    expect(mark).toBeDefined();
    const shares = fairShares(11, [{ id: "older", want: 200, since: null }, mark as PoolMark]);
    expect(shares.get("q")).toBe(5);
    expect(shares.get("older")).toBe(6);
  });
});

describe("QuietDemand", () => {
  test("asks for a write when the demand changes or 5 s passed, and none for 0 again", () => {
    const demand = new QuietDemand();
    expect(demand.state(0, 0)).toBe(false);
    expect(demand.state(64, 0)).toBe(true);
    expect(demand.state(64, QUIET_DEMAND_WRITE_MS - 1)).toBe(false);
    expect(demand.state(64, QUIET_DEMAND_WRITE_MS)).toBe(true);
    expect(demand.state(3.7, QUIET_DEMAND_WRITE_MS)).toBe(true);
    expect(demand.want).toBe(3);
    expect(demand.state(0, QUIET_DEMAND_WRITE_MS)).toBe(true);
    expect(demand.state(0, 2 * QUIET_DEMAND_WRITE_MS)).toBe(false);
    demand.state(8, 0);
    demand.end();
    expect(demand.want).toBe(0);
    expect(demand.state(8, 1)).toBe(true);
  });
});
