import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool, type PoolLease } from "../../src/core/capacity/pool.js";
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
 *
 * Row 011-429: no case bounds that step in milliseconds any more. A loaded
 * runner stretched it to 4 s (CI 45710459569) and let two other slots free
 * meanwhile (CI 41207574795, 42882566785). Test 1 counts the refills that
 * came while a slot of the earlier wave still ran, which a tier's barrier
 * never does; test 4 checks that no slot the holder started while the waiter
 * waited ran to its end first. How fast the scheduler refills is speed, logged.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long after a slot returns its permit the waiter of test 4 looks, and
 * then how often: longer than the holder's pump takes to refill a slot
 * (tens of ms at load 75), so a holder that takes the permit back has by then.
 */
const LOOK_MS = 250;

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
 * free while files were queued, `passed` how many other places freed in it,
 * and `ahead` how many runs already in flight when it freed still ran when
 * it was refilled: a barrier that waits for every slot of a tier leaves none.
 */
function refills(
  runs: readonly Span[],
  width: number,
): { idleMs: number; passed: number; ahead: number }[] {
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  const ends = runs.map((r) => r.end).sort((a, b) => a - b);
  const freed = [...sorted.slice(0, width).map(() => sorted[0]?.start ?? 0), ...ends];
  return sorted.map((run, k) => {
    const at = freed[k] ?? Number.NaN;
    const ahead = sorted.filter((o) => o !== run && o.start < at && o.end > run.start).length;
    return {
      idleMs: run.start - at,
      passed: ends.filter((e) => e > at && e < run.start).length,
      ahead,
    };
  });
}

describe("scheduler: a node:test backlog in one-file slots (task 011-21 slice 2)", () => {
  it("1. runs 16 files of 1 to 5 s at W = 4: no slot idle while files are queued, W slots at once, progress per file", {
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
    await h.quiet();

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
    // A slot the pool refuses waits for its next look (a pump wake), as `idle()` waited.
    await h.quiet({ through: ["pump"] });
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
      `011-21 slots: 16 files in ${Math.round(actual)} ms against list scheduling's ${Math.round(list)} ms (${((actual / list - 1) * 100).toFixed(1)} %), ${steps.size} progress steps; slots idled ${gaps.map((g) => Math.round(g.idleMs)).join(" ")} ms (at most ${Math.round(idle)}), other slots freeing meanwhile ${gaps.map((g) => g.passed).join(" ")}, earlier slots still running ${gaps.map((g) => g.ahead).join(" ")}`,
    );
    // No slot waits for the rest of its wave while files are queued (within 5 % of list
    // scheduling on a quiet host: 2.2 % and 3.6 % measured). A barrier that waits for every
    // slot of a tier refills none while an earlier slot runs; slots refill most that way. A
    // stall of this process can let a wave end before one refill, so not every one is asked.
    const refilled = gaps.slice(4);
    expect(refilled.filter((g) => g.ahead > 0).length).toBeGreaterThan(refilled.length / 2);
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
    expect(other.acquire(2)).toBeNull();
    const waitedFrom = Date.now();
    // The slots holding the pool when the waiter came, and the first of them to return its permit.
    const holding = runs.filter((r) => r.end === null);
    await expect
      .poll(() => holding.some((r) => r.end !== null), { timeout: 30_000, interval: 10 })
      .toBe(true);
    const released = Math.min(...holding.map((r) => r.end ?? Number.POSITIVE_INFINITY));
    let share: PoolLease | null = null;
    while (share === null && Date.now() - waitedFrom < 30_000) {
      await sleep(LOOK_MS);
      share = other.acquire(2);
    }
    const grantedAt = Date.now();
    // Each slot the holder started while the waiter waited, and its slots in flight then.
    const inFlightAt = (at: number) =>
      runs.filter((r) => r.start <= at && (r.end ?? Number.POSITIVE_INFINITY) > at).length;
    const refilled = runs
      .filter((r) => r.start > waitedFrom && r.start <= grantedAt)
      .map((r) => ({ path: r.files[0]?.path, held: inFlightAt(r.start) }));
    console.log(
      `011-21 slots: the waiter got its share after ${grantedAt - waitedFrom} ms, ${grantedAt - released} ms after the first slot of ${holding.length} returned its permit (a slot's file ${SLOT_MS} ms); the holder refilled to ${refilled.map((r) => r.held).join(" ") || "none"} meanwhile`,
    );
    expect(share?.grant).toBeGreaterThanOrEqual(1);
    // Granted at the next slot release, not one tier later. When several slots end before the
    // waiter looks, the holder refills up to its share of 2; above it, it took the waiter's permit.
    expect(refilled.filter((r) => r.held > 2).map((r) => `${r.path} to ${r.held}`)).toEqual([]);
    // Within one slot's file: no slot the holder started while the waiter waited ran to its
    // end before the share came, as one would when the waiter waits for the holder's next tier.
    expect(
      runs
        .filter((r) => r.start > waitedFrom && r.end !== null && r.end <= grantedAt)
        .map((r) => r.files[0]?.path),
    ).toEqual([]);

    other.close();
    // The holder takes the waiter's permits back at its pool's next look (a pump wake).
    await h.quiet({ through: ["pump"] });
    const ran = runs.flatMap((r) => r.files.map((f) => f.path));
    expect(ran.sort()).toEqual(files.map((f) => testPath(f.name)));
  });
});
