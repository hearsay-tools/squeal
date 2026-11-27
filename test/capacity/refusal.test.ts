import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { HostCpu, TreeCpu } from "../../src/core/capacity/cores.js";
import { writeMark } from "../../src/core/capacity/marks.js";
import {
  createPermitPool,
  type PermitPool,
  type PermitPoolOptions,
} from "../../src/core/capacity/pool.js";
import { TierCapacity, WAIT_FOR_CAPACITY } from "../../src/core/scheduler/capacity.js";

/*
 * Row 017-37 (gh-238, research/lint-gate-stall.md F3): a backlog look that
 * gets nothing keeps its cause, the ceiling's, the share's or the queue's,
 * and `TierCapacity.backgroundGate` gives it to the lint pass (agreed with
 * coordinator b468025e, 2026-11-28). 24 CPUs: the ceiling is 18 busy.
 */

let root: string;
let dir: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-refusal-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const c of closers.splice(0)) c.close();
  rmSync(root, { recursive: true, force: true });
});

const tree: TreeCpu = { read: () => 0, reset() {} };
const host = (cores: number): HostCpu => ({ read: () => cores });

function daemon(id: string, busy: number, over: Partial<PermitPoolOptions> = {}): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 4,
    cpus: 24,
    cores: tree,
    host: host(busy),
    ...over,
  });
  closers.push(pool);
  return pool;
}

/** Another daemon's background tier runs, so no floor serves the waiter. */
const backgroundRuns = () =>
  writeMark(dir, { id: "runs", want: 1, grant: 1, since: null, cores: 1, background: 1 });

describe("why the pool refused a backlog tier (row 017-37)", () => {
  test("none before the first backlog look, and none after a grant", () => {
    const pool = daemon("me", 1);
    expect(pool.refusal()).toBeNull();
    pool.acquire(1, "slow", 1, "checkpoint")?.release();
    expect(pool.refusal()).toBeNull();
    const lease = pool.acquire(1, "slow", 1, "backlog");
    expect(lease?.grant).toBe(1);
    expect(pool.refusal()).toBeNull();
  });

  test("the ceiling: busy CPUs at the limit", () => {
    backgroundRuns();
    const pool = daemon("me", 18);
    expect(pool.acquire(1, "slow", 1, "backlog")).toBeNull();
    expect(pool.refusal()).toBe("ceiling");
    expect(pool.gate()?.busyCores).toBe(18);
  });

  test("the share: the project's other daemon holds its cap, with busy CPUs below the limit", () => {
    backgroundRuns();
    const project = { id: "p", slots: 1 };
    writeMark(dir, { id: "sibling", want: 1, grant: 1, since: null, project, background: 1 });
    const pool = daemon("me", 2, { project });
    expect(pool.acquire(1, "slow", 1, "backlog")).toBeNull();
    expect(pool.refusal()).toBe("share");
  });

  test("the share wins over the ceiling, as the log's ceiling line does", () => {
    backgroundRuns();
    const project = { id: "p", slots: 1 };
    writeMark(dir, { id: "sibling", want: 1, grant: 1, since: null, project, background: 1 });
    const pool = daemon("me", 20, { project });
    expect(pool.acquire(1, "slow", 1, "backlog")).toBeNull();
    expect(pool.refusal()).toBe("share");
  });

  test("the queue: every permit held, with a share and CPUs left", () => {
    const holder = daemon("holder", 0, { hostSlots: 2 });
    const held = holder.acquire(2, "fast", 1, "checkpoint");
    expect(held?.grant).toBe(2);
    backgroundRuns();
    const pool = daemon("me", 2, { hostSlots: 2 });
    expect(pool.acquire(1, "slow", 1, "backlog")).toBeNull();
    expect(pool.refusal()).toBe("queue");
    held?.release();
    expect(pool.acquire(1, "slow", 1, "backlog")?.grant).toBe(1);
    expect(pool.refusal()).toBeNull();
  });

  test("TierCapacity.backgroundGate gives the cause with the busy CPUs and the limit", () => {
    backgroundRuns();
    const project = { id: "p", slots: 1 };
    writeMark(dir, { id: "sibling", want: 1, grant: 1, since: null, project, background: 1 });
    const capacity = new TierCapacity(
      { dir, hostSlots: 4, cpus: 24, host: host(2), project },
      "me",
      () => {},
    );
    closers.push(capacity);
    expect(capacity.take(1, "slow", 1, "backlog")).toBe(WAIT_FOR_CAPACITY);
    expect(capacity.backgroundGate()).toMatchObject({ limit: 18, refusal: "share" });
    expect(capacity.backgroundGate()?.busy).toBeLessThan(18);
  });
});
