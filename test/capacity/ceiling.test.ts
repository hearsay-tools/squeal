import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  backgroundCeiling,
  ceilingRefusalLine,
  DEFAULT_BACKGROUND_SHARE,
} from "../../src/core/capacity/background.js";
import type { HostCpu, TreeCpu } from "../../src/core/capacity/cores.js";
import { clearMark, type PoolMark, readMarks, writeMark } from "../../src/core/capacity/marks.js";
import { createPermitPool, type PermitPool } from "../../src/core/capacity/pool.js";

/*
 * Spec 021 D18 as amended 2026-11-11 (row 021-18): a backlog tier takes a
 * permit only while the host's busy CPUs are below the ceiling, a share of
 * the machine's CPUs (`capacity.backgroundShare`, default 0.75). When no
 * background tier of the user's daemons runs, the oldest waiting one takes
 * its fewest workers. Checkpoints keep today's gate. Each refusal by the
 * ceiling writes one line to the daemon's log. The machine here has 24 CPUs
 * and 23 slots, so the default ceiling is 18 busy CPUs.
 */

let root: string;
let dir: string;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-ceiling-test-"));
  dir = join(root, "squeal-uid");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

const tree: TreeCpu = { read: () => 0, reset() {} };

/** A host whose busy cores the test sets. */
function host(cores: number | null): HostCpu & { cores: number | null } {
  return {
    cores,
    read() {
      return this.cores;
    },
  };
}

function daemon(
  id: string,
  busy: HostCpu | null,
  options: { share?: number; log?: string[]; now?: () => number } = {},
): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 23,
    cpus: 24,
    cores: tree,
    host: busy,
    ...(options.share === undefined ? {} : { backgroundShare: options.share }),
    ...(options.log === undefined ? {} : { log: (line: string) => options.log?.push(line) }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  pools.push(pool);
  return pool;
}

/** Another daemon whose background tier runs on one permit. */
function backgroundRuns(): void {
  writeMark(dir, { id: "runs", want: 1, grant: 1, since: null, cores: 1, background: 1 });
}

const markOf = (id: string) => readMarks(dir, "reader", Date.now()).find((m) => m.id === id);

/** Closes the pools so far: their marks go, the marks the test wrote stay. */
function closeAll(): void {
  for (const pool of pools.splice(0)) pool.close();
}

describe("the background ceiling (spec 021 D18)", () => {
  test("refuses a backlog tier at and above the ceiling and admits it below", () => {
    backgroundRuns();
    for (const busy of [18, 18.01, 23.9]) {
      expect(daemon("me", host(busy)).acquire(8, "fast", 1, "backlog")).toBeNull();
      closeAll();
    }
    // 17.5 busy: one permit brings the cores past the ceiling; 10 busy: eight reach it.
    expect(daemon("below", host(17.5)).acquire(8, "fast", 1, "backlog")?.grant).toBe(1);
    closeAll();
    expect(daemon("quiet", host(10)).offer(10, "fast", "backlog")).toBe(8);
    expect(daemon("quiet-too", host(10)).acquire(10, "fast", 1, "backlog")?.grant).toBe(8);
  });

  test("leaves a checkpoint's tier gated as today: the marks' cores and half the slots by grants", () => {
    backgroundRuns();
    expect(daemon("checkpoint", host(23.9)).acquire(10, "fast", 1, "checkpoint")?.grant).toBe(10);
    closeAll();
    // Marks over the slots: a checkpoint takes permits while the grants are below half of them.
    writeMark(dir, { id: "full", want: 9, grant: 9, since: null, cores: 30, background: 0 });
    expect(daemon("checkpoint", host(1)).acquire(10, "fast", 1, "checkpoint")?.grant).toBe(2);
  });

  test("changes with capacity.backgroundShare, and a value out of range keeps the default", () => {
    backgroundRuns();
    const grant = (busy: number, share: number) => {
      const taken = daemon("me", host(busy), { share }).acquire(8, "fast", 1, "backlog")?.grant;
      closeAll();
      return taken ?? 0;
    };
    // Half of 24 CPUs: 12 busy is refused, 11 takes one permit.
    expect(grant(12, 0.5)).toBe(0);
    expect(grant(11, 0.5)).toBe(1);
    // A share of 0: no permit past the floor. One above 1 is not taken: the default, 18, stands.
    expect(grant(0.5, 0)).toBe(0);
    expect(grant(17, 1.5)).toBe(1);
    expect(grant(17, 1)).toBe(6);
  });

  test("defaults to 75% of the CPUs: 3 on a 4-CPU machine, 18 on a 24-CPU one", () => {
    expect(DEFAULT_BACKGROUND_SHARE).toBe(0.75);
    expect(backgroundCeiling(DEFAULT_BACKGROUND_SHARE, 4)).toBe(3);
    expect(backgroundCeiling(DEFAULT_BACKGROUND_SHARE, 24)).toBe(18);
    expect(backgroundCeiling(0.1, 3)).toBe(0.3);
  });

  test("does not bind where the host's busy cores are not read: the slots do", () => {
    backgroundRuns();
    expect(daemon("unread", host(null)).acquire(30, "fast", 1, "backlog")?.grant).toBe(22);
  });
});

describe("the floor (spec 021 D18)", () => {
  test("gives the waiter served first its tier's fewest workers when no background tier runs", () => {
    const me = daemon("me", host(23.9));
    const first = me.acquire(8, "fast", 1, "backlog");
    expect(first?.grant).toBe(1);
    expect(markOf("me")).toMatchObject({ grant: 1, background: 1 });
    // Its own background tier runs: no second floor.
    expect(me.acquire(8, "fast", 1, "backlog")).toBeNull();
    first?.release();
    // A tier whose runner runs 2 workers at a grant of 1 takes 2.
    expect(me.acquire(8, "fast", 2, "backlog")?.grant).toBe(2);
  });

  test("serves no one while another daemon's background tier runs, and counts an older release's grant as one", () => {
    backgroundRuns();
    expect(daemon("me", host(23.9)).acquire(8, "fast", 1, "backlog")).toBeNull();
    closeAll();
    clearMark(dir, "runs");
    // A mark without `background` is an older release's: its grant counts as background.
    writeMark(dir, { id: "older", want: 1, grant: 1, since: null, cores: 1 });
    expect(daemon("me", host(23.9)).acquire(8, "fast", 1, "backlog")).toBeNull();
    closeAll();
    // A daemon whose permits are a checkpoint's states 0 background permits: the floor serves.
    writeMark(dir, { id: "older", want: 1, grant: 1, since: null, cores: 1, background: 0 });
    expect(daemon("me", host(23.9)).acquire(8, "fast", 1, "backlog")?.grant).toBe(1);
  });

  test("serves the oldest waiter, and one it served waits behind the others at its next look", () => {
    let clock = Date.now();
    const now = () => clock;
    const a = daemon("a", host(23.9), { now });
    const b = daemon("b", host(23.9), { now });
    // Both wait while another daemon's background tier runs, B first.
    backgroundRuns();
    expect(b.acquire(4, "fast", 1, "backlog")).toBeNull();
    clock += 1_000;
    expect(a.acquire(4, "fast", 1, "backlog")).toBeNull();
    clearMark(dir, "runs");
    // That tier ended. A, younger, is not served while B waits; B is.
    clock += 1_000;
    expect(a.acquire(4, "fast", 1, "backlog")).toBeNull();
    const bLease = b.acquire(4, "fast", 1, "backlog");
    expect(bLease?.grant).toBe(1);
    expect(markOf("b")?.since).toBeNull();
    bLease?.release();
    // B looks again: A waited longer since B's floor, so B waits behind A.
    clock += 1_000;
    expect(b.acquire(4, "fast", 1, "backlog")).toBeNull();
    clock += 1_000;
    expect(a.acquire(4, "fast", 1, "backlog")?.grant).toBe(1);
  });
});

describe("the refusal's log line (spec 021 D18)", () => {
  test("is written for each refusal by the ceiling, with the busy CPUs read, and for no offer", () => {
    backgroundRuns();
    const log: string[] = [];
    const me = daemon("me", host(19.36), { log });
    expect(me.offer(8, "fast", "backlog")).toBe(0);
    expect(log).toEqual([]);
    expect(me.acquire(8, "fast", 1, "backlog")).toBeNull();
    expect(me.acquire(8, "fast", 1, "backlog")).toBeNull();
    const line =
      "the background ceiling refused a backlog tier: 19.4 busy CPUs, ceiling 18 (0.75 of 24 CPUs)";
    expect(log).toEqual([line, line]);
  });

  test("is not written for a grant, a checkpoint's refusal, the floor or an unread host", () => {
    const log: string[] = [];
    // The floor serves this one: no line.
    expect(daemon("floor", host(23.9), { log }).acquire(8, "fast", 1, "backlog")?.grant).toBe(1);
    closeAll();
    backgroundRuns();
    expect(daemon("granted", host(4), { log }).acquire(8, "fast", 1, "backlog")?.grant).toBe(8);
    writeMark(dir, { id: "full", want: 30, grant: 12, since: null, cores: 40, background: 0 });
    expect(daemon("checkpoint", host(4), { log }).acquire(8, "fast", 1, "checkpoint")).toBeNull();
    expect(daemon("unread", host(null), { log }).acquire(8, "fast", 1, "backlog")).toBeNull();
    expect(log).toEqual([]);
  });

  test("names the slots when they are fewer than the ceiling", () => {
    const refusal = { busy: 7, ceiling: 18, share: 0.75, cpus: 24, hostSlots: 6 };
    expect(ceilingRefusalLine(refusal)).toBe(
      "the background ceiling refused a backlog tier: 7 busy CPUs, ceiling 18 (0.75 of 24 CPUs, 6 test slots)",
    );
  });
});

describe("the mark's background permits (spec 021 D18)", () => {
  test("state what the daemon's backlog tiers hold, not its checkpoints' or an edit's", () => {
    const me = daemon("me", host(1));
    const checkpoint = me.acquire(3, "fast", 1, "checkpoint");
    expect(markOf("me")).toMatchObject({ grant: 3, background: 0 });
    const backlog = me.acquire(2, "fast", 1, "backlog");
    expect(markOf("me")).toMatchObject({ grant: 5, background: 2 });
    checkpoint?.release();
    backlog?.release();
    const end = me.running(2);
    expect(markOf("me")).toMatchObject({ grant: 0, background: 0 });
    end();
    const mark: PoolMark = { id: "x", want: 1, grant: 1, since: null, background: 1 };
    writeMark(dir, mark);
    expect(markOf("x")?.background).toBe(1);
  });
});
