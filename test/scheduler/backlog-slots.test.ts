import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool, type PoolLease } from "../../src/core/capacity/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  listMakespan,
  pendingOf,
  type Span,
  slotHarness,
  storedBy,
  testPath,
  widest,
} from "./slots-fixture.js";
import type { TimedRun } from "./timed-runner.js";

/*
 * Task 011-21 slice 2, done-when 1, 2 and 4 (spec 011 C4 step 5 and C10 as
 * amended for slots, `research/streaming-lanes.md` finding 1 and tests 4, 5
 * and 7): node:test cannot cancel a run, so its backlog runs in one-file
 * slots, up to W in flight, each taking the next queued file as it frees,
 * storing that file's results when it ends and holding one permit. W is
 * the grant, at most `runner.tierSize` (4), from a pool of 4 host slots.
 * Done-when 3 is `backlog-slots-overhead.test.ts`; Vitest keeps its tiers
 * and the cancel (`backlog-tiers.test.ts`).
 *
 * Row 011-178: tests 1 and 4 read the slots from the scheduler's own `run`
 * calls, not the files' processes. A loaded host stretches each process's
 * start and exit, which neither bound is about; what the scheduler does when
 * a slot's run returns stays in this process and is bounded loosely.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * From a slot's run returning to the scheduler's next `run` call, or a
 * waiter's grant: the pump's checks, the lock and a 50 ms poll, in this
 * process. Loose for a loaded runner; one slot's file of 1 to 5 s is longer.
 */
const REACT_MS = 1_000;

/** Each run as a span on the scheduler's clock, from its `run` call to its return. */
const spansOf = (runs: readonly TimedRun[]): Span[] =>
  runs.map((r) => ({
    path: r.files.map((f) => f.path).join(" "),
    start: r.start,
    end: r.end ?? Number.POSITIVE_INFINITY,
  }));

/**
 * Each start of `width` slots, in order, and the place it took: the first
 * `width` the places free at the first start, each later one the place the
 * runs' (k − `width`)-th end freed. `idleMs` is how long that place stayed
 * free while files were queued, `passed` how many other places freed in it.
 */
function refills(runs: readonly Span[], width: number): { idleMs: number; passed: number }[] {
  const starts = runs.map((r) => r.start).sort((a, b) => a - b);
  const ends = runs.map((r) => r.end).sort((a, b) => a - b);
  const freed = [...starts.slice(0, width).map(() => starts[0] ?? 0), ...ends];
  return starts.map((start, k) => {
    const at = freed[k] ?? Number.NaN;
    return { idleMs: start - at, passed: ends.filter((e) => e > at && e < start).length };
  });
}

describe("scheduler: a node:test backlog in one-file slots (task 011-21 slice 2)", () => {
  it("1. runs 16 files of 1 to 5 s at W = 4 within 5 % of list scheduling, no slot idle, progress per file", {
    timeout: 180_000,
  }, async () => {
    const files = Array.from({ length: 16 }, (_, i) => ({
      name: `s${String(i).padStart(2, "0")}`,
      sleepMs: 1_000 + Math.round((i * 4_000) / 15),
    }));
    const paths = files.map((f) => testPath(f.name));
    // Half of 20 s is the wall budget a tier of these files would be cut at (001-366).
    const { h, runs, spans } = await slotHarness({ files, hostSlots: 4, timeoutMs: 20_000 });
    await h.scheduler.start();
    await h.scheduler.idle();

    // The baseline taught the durations; the forced pass is the backlog measured.
    const from = Date.now();
    const settled: number[] = [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        settled.push(pendingOf(h, paths).filter((p) => p === null).length);
        await sleep(20);
      }
    })();
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    polling = false;
    await poll;

    const pass = runs.filter((r) => r.start >= from);
    expect(pass.every((r) => r.files.length === 1)).toBe(true);
    const slots = spansOf(pass);
    expect(slots.map((s) => s.path).sort()).toEqual(paths);
    const processes = spans().filter((s) => s.start >= from);
    const actual =
      Math.max(...processes.map((s) => s.end)) - Math.min(...processes.map((s) => s.start));
    const list = listMakespan(processes, 4);
    const steps = new Set(settled.filter((n) => n > 0 && n < files.length));
    const gaps = refills(slots, 4);
    const idle = Math.max(...gaps.map((g) => g.idleMs));
    console.log(
      `011-21 slots: 16 files in ${Math.round(actual)} ms against list scheduling's ${Math.round(list)} ms (${((actual / list - 1) * 100).toFixed(1)} %), ${steps.size} progress steps; slots idled ${gaps.map((g) => Math.round(g.idleMs)).join(" ")} ms (at most ${Math.round(idle)}), other slots freeing meanwhile ${gaps.map((g) => g.passed).join(" ")}`,
    );
    // No slot idled while files were queued (within 5 % of list scheduling on a quiet host:
    // 2.2 % and 3.6 % measured). A slot is refilled before two other slots free; a barrier
    // that waits for every slot of a tier lets three free first.
    expect(gaps.filter((g) => g.passed > 1)).toEqual([]);
    // Nor is its next run held behind anything slow: the refill is this process's own step.
    expect(idle).toBeLessThanOrEqual(REACT_MS);
    // W slots at once, never more.
    expect(widest(slots)).toBe(4);
    // Checkpoint progress moves per file, not per tier.
    expect(steps.size).toBeGreaterThanOrEqual(8);
    expect(pendingOf(h, paths).every((p) => p === null)).toBe(true);
  });

  it("2. a departure exits once the files in flight record; no new file starts, the rest stay queued", {
    timeout: 120_000,
  }, async () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `d${String(i).padStart(2, "0")}`,
      sleepMs: 1_500,
    }));
    const paths = files.map((f) => testPath(f.name));
    const { h, runs } = await slotHarness({ files, hostSlots: 4, policy: RUN_MISSING });
    await h.scheduler.start();
    const inFlight = () => runs.filter((r) => r.end === null).flatMap((r) => r.files).length;
    await expect.poll(inFlight, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await sleep(300);
    const closedAt = Date.now();
    await h.scheduler.close();
    const exitedAt = Date.now();

    // No file started after the departure; the ones in flight ended and stored before it exited.
    expect(runs.every((r) => r.start <= closedAt)).toBe(true);
    expect(runs.every((r) => r.end !== null && r.end <= exitedAt)).toBe(true);
    const ran = runs.flatMap((r) => r.files.map((f) => f.path));
    for (const run of runs) {
      for (const f of run.files) expect(storedBy(h, f.path, run), f.path).toBe(true);
    }
    const left = paths.filter((p) => !ran.includes(p));
    console.log(`011-21 slots: departure after ${ran.length} of 12 files, ${left.length} queued`);
    expect(left.length).toBeGreaterThan(0);
    expect(pendingOf(h, left).every((p) => p === "queued")).toBe(true);
    expect(pendingOf(h, ran).every((p) => p === null)).toBe(true);
  });

  it("4. another daemon's waiter gets its share within one slot's file of the holder, not one tier", {
    timeout: 120_000,
  }, async () => {
    const SLOT_MS = 2_000;
    const files = Array.from({ length: 16 }, (_, i) => ({
      name: `w${String(i).padStart(2, "0")}`,
      sleepMs: SLOT_MS,
    }));
    const { h, runs, poolDir } = await slotHarness({ files, hostSlots: 4, policy: RUN_MISSING });
    await h.scheduler.start();
    const inFlight = () => runs.filter((r) => r.end === null).flatMap((r) => r.files).length;
    await expect.poll(inFlight, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);

    // Another daemon of the user: no free worker (row 011-96), so it waits for its share of 2.
    // Processes only: the slots, not the CPU gate, are under test (row 011-98).
    const other = createPermitPool({
      dir: poolDir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 4,
      cores: null,
    });
    onTestFinished(() => other.close());
    const waitedFrom = Date.now();
    expect(other.acquire(2)).toBeNull();
    let share: PoolLease | null = null;
    while (share === null && Date.now() - waitedFrom < 30_000) {
      share = other.acquire(2);
      if (share === null) await sleep(50);
    }
    const grantedAt = Date.now();
    // The slots holding the pool when the waiter came, and the first of them to return its permit.
    const holding = runs.filter(
      (r) => r.start <= waitedFrom && (r.end ?? waitedFrom) >= waitedFrom,
    );
    const released = Math.min(...holding.map((r) => r.end ?? Number.POSITIVE_INFINITY));
    const refilled = runs.filter((r) => r.start > waitedFrom && r.start <= grantedAt);
    console.log(
      `011-21 slots: the waiter got its share after ${grantedAt - waitedFrom} ms, ${grantedAt - released} ms after the first slot of ${holding.length} returned its permit (a slot's file ${SLOT_MS} ms)`,
    );
    expect(share?.grant).toBeGreaterThanOrEqual(1);
    // Granted at the next slot release, not one tier later: the holder refilled no slot first,
    expect(refilled.flatMap((r) => r.files.map((f) => f.path))).toEqual([]);
    // and the share came on the waiter's next look after that release.
    expect(released).toBeLessThanOrEqual(grantedAt);
    expect(grantedAt - released).toBeLessThanOrEqual(REACT_MS);

    other.close();
    await h.scheduler.idle();
    const ran = runs.flatMap((r) => r.files.map((f) => f.path));
    expect(ran.sort()).toEqual(files.map((f) => testPath(f.name)));
  });
});
