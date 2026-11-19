import { describe, expect, it } from "vitest";
import { OVERRUN_FACTOR, OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import { readYieldRow } from "../../src/core/scheduler/yield-row.js";
import { yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { BESIDE_LANE_PREFIX, isBesideLane } from "../../src/core/types/runner.js";
import type { TierOverrun } from "../../src/core/types/standing.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { Gate } from "./batch-fixture.js";
import {
  type CatchUpFile,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, settle } from "./tier-yields-fixture.js";

/*
 * Row 011-399 (gh-233, `research/stuck-running.md` shape 1, E1b): a tier of
 * 4 whose file H never ends no longer holds its lane. Once every unfinished
 * file has run `OVERRUN_FACTOR` times its last-known duration and at least
 * `OVERRUN_FLOOR_MS`, the lane's next tier starts beside it in the second
 * instance, as beside a named wait's batch (C4 step 5, row 011-269). H keeps
 * running; nothing about its result changes. The scheduler's clock is a
 * virtual one, so the minute passes at once. The fake runner reports no
 * file's end, so the tier's four files are all unfinished, as E1b's hung
 * tier was before its mates ended.
 */

const H = "test/h.test.ts";
const MATES = ["test/m0.test.ts", "test/m1.test.ts", "test/m2.test.ts"];
const queued = (count: number) =>
  Array.from({ length: count }, (_, i) => `test/q${String(i).padStart(4, "0")}.test.ts`);

/** H and its mates lead the edit's order (shortest first); every file imports `src/a.ts`. */
function files(hMs: number, count: number): CatchUpFile[] {
  return [
    { path: H, ms: hMs, imports: ["src/a.ts"] },
    ...MATES.map((path) => ({ path, ms: hMs, imports: ["src/a.ts"] })),
    ...queued(count).map((path) => ({ path, ms: Math.max(10, hMs + 1), imports: ["src/a.ts"] })),
  ];
}

const besideRuns = (side: CatchUpSide, after: number) =>
  side.runner.runs.slice(after).filter((run) => isBesideLane(run.lane ?? ""));
const pathsOf = (run: CatchUpRun) => run.files.map((f) => f.path);

/** The overruns `side`'s daemon published in its `yields` row (additive key, row 011-399). */
function overrunsOf(side: CatchUpSide): TierOverrun[] {
  const row = readYieldRow(side.store.meta.get(yieldsMetaKey(side.worktreeId)), 0 as EpochMs);
  return [...(row.overruns ?? new Map<string, TierOverrun>()).values()];
}

/**
 * After a baseline, an edit of `src/a.ts` queues every file as the edit's
 * work; the first tier holds H and its three mates and stays in flight. Runs
 * beside it wait on `beside` while it holds.
 */
async function hungTier(hMs: number, count: number) {
  const all = files(hMs, count);
  const repo = catchUpRepo(all);
  const side = catchUpSide(repo, repo.main, {
    files: all,
    hostSlots: 8,
    policy: RUN_MISSING,
    clock: "virtual",
  });
  await side.scheduler.start();
  await settle(side);
  const hung = new Gate();
  const beside = new Gate();
  side.runner.holdOf = (run) => {
    if (isBesideLane(run.lane ?? "")) return beside.wait();
    return pathsOf(run).includes(H) ? hung.wait() : undefined;
  };
  const after = side.runner.runs.length;
  await side.edit("watch", "src/a.ts");
  const tier = await heldRun(side, H, after);
  return { side, hung, beside, tier, after };
}

describe("a file far past its own time does not block its lane (row 011-399, gh-233)", {
  timeout: 120_000,
}, () => {
  it("with 1,000 queued, the next tier starts beside the hung one at the floor, and the next after it", async () => {
    const { side, hung, beside, tier, after } = await hungTier(5, 1_000);
    expect(pathsOf(tier).toSorted()).toEqual([H, ...MATES].toSorted());
    expect(side.runner.runs.slice(after)).toEqual([tier]);

    // Under the threshold nothing changes: the lane waits for the tier, as before.
    const startedAt = side.now();
    side.advance(OVERRUN_FLOOR_MS - 1_000);
    await settle(side);
    expect(side.runner.runs.slice(after)).toEqual([tier]);
    expect(overrunsOf(side)).toEqual([]);

    // At the floor (5 ms x 10 is under it), the next tier starts beside, with no other event.
    side.advance(1_000);
    await settle(side);
    const [first, ...rest] = besideRuns(side, after);
    expect(rest).toEqual([]);
    expect(first?.lane).toBe(BESIDE_LANE_PREFIX);
    // An edit's tier: `runner.tierSize` files, no grant, so no permit (C10).
    expect(first?.files).toHaveLength(4);
    expect(first?.workers).toBeUndefined();
    expect(pathsOf(first as CatchUpRun).every((path) => path.startsWith("test/q"))).toBe(true);
    expect(tier.endedAt).toBeNull();
    expect(tier.cancelled).toBe(false);
    // The row says so, with no other event: since when, the run's deadline and the files left.
    const [overrun, ...others] = overrunsOf(side);
    expect(others).toEqual([]);
    expect(overrun?.files.map((f) => f.path).toSorted()).toEqual([H, ...MATES].toSorted());
    expect(overrun?.files.every((f) => f.usualMs === 5)).toBe(true);
    expect(overrun?.at).toBeGreaterThanOrEqual(startedAt + OVERRUN_FLOOR_MS - 1_000);
    expect(overrun?.deadline).toBeGreaterThan(overrun?.at ?? 0);

    // One tier beside at a time; when it ends, the next goes beside while H still runs.
    beside.release();
    await settle(side);
    expect(besideRuns(side, after)).toHaveLength(2);
    expect(side.runner.released).not.toContain(BESIDE_LANE_PREFIX);
    expect(tier.endedAt).toBeNull();
    hung.stop();
    beside.stop();
  });

  it("with nothing queued, no tier goes beside, and the row still says the tier overruns", async () => {
    const { side, hung, tier, after } = await hungTier(5, 0);
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(side.runner.runs.slice(after)).toEqual([tier]);
    expect(
      overrunsOf(side)
        .flatMap((o) => o.files.map((f) => f.path))
        .toSorted(),
    ).toEqual([H, ...MATES].toSorted());
    hung.stop();
  });

  it("a file with a known time waits for 10 times it, its result is H's own, and the second instance closes after", async () => {
    const hMs = 10_000;
    const { side, hung, beside, tier, after } = await hungTier(hMs, 12);
    beside.stop();

    // 60 s is past the floor but under 10 x 10 s: a slow file under the threshold changes nothing.
    side.advance(OVERRUN_FLOOR_MS);
    await settle(side);
    expect(besideRuns(side, after)).toEqual([]);

    side.advance(OVERRUN_FACTOR * hMs - OVERRUN_FLOOR_MS);
    await settle(side);
    expect(overrunsOf(side).map((o) => o.files.find((f) => f.path === H)?.usualMs)).toEqual([hMs]);
    const ranBeside = besideRuns(side, after).flatMap(pathsOf);
    expect(ranBeside.toSorted()).toEqual(queued(12));
    expect(queued(12).every((path) => side.current(path))).toBe(true);
    expect(side.current(H)).toBe(false);
    expect(tier.endedAt).toBeNull();

    // H ends as it would have: its own run stores its result, and the second instance closes.
    hung.stop();
    await settle(side);
    expect(tier.cancelled).toBe(false);
    expect(side.current(H)).toBe(true);
    expect(side.runner.runsOf(H).slice(1)).toEqual([tier]);
    expect(side.runner.released).toContain(BESIDE_LANE_PREFIX);
    expect(overrunsOf(side)).toEqual([]);
  });
});
