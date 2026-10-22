import { describe, expect, it } from "vitest";
import { publishedYields, YIELD_REMAINDER_MS } from "../../src/core/scheduler/yields.js";
import type { Policy } from "../../src/core/types/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import {
  CUT_WITHIN_MS,
  heldRun,
  holdRuns,
  order,
  pause,
  ref,
  SETTLE_MS,
} from "./tier-yields-fixture.js";

/*
 * Row 011-107 (gh-73; spec 011 C4 step 5 as the digest of 2026-10-22, group
 * B, amends it): a tier that has run `YIELD_REMAINDER_MS` past its estimate
 * yields to a promoted wait as one whose remainder exceeds it does, once per
 * file and key, when every file it would cut was last at least
 * `SHARE_FLOOR_MS`. Before it, a tier past its estimate never yielded: on
 * 0.1.238 a wait read "its estimated remainder was 0 s, not over 30 s" and
 * waited 55 s more. The scheduler's clock runs `skew` ahead of the real one,
 * so a tier has run past its estimate without the test waiting for it; a
 * held run stands for one that takes longer than its files' `ms`.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const isSlow = (path: string) => SLOW.includes(path);
const F = "test/f.test.ts";

/** How far the scheduler's clock runs ahead of the real one; each tier starts it at 0. */
const clock = { skew: 0 };
const now = () => Date.now() + clock.skew;

/**
 * A tier of the four slow files, `ms` each last time, held in flight from
 * a clock at 0 skew; `F`, and `extra`, are 1 ms files of the same lane.
 */
async function heldTier(ms: number, extra: readonly string[] = [], policy?: Partial<Policy>) {
  clock.skew = 0;
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    ...[F, ...extra].map((path) => ({ path, ms: 1, imports: [path.replace("test/", "src/")] })),
  ];
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    now,
    ...(policy === undefined ? {} : { policy }),
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const gate = holdRuns(side.runner, isSlow);
  await side.edit("watch", "src/s.ts");
  const tier = await heldRun(side, SLOW[0] ?? "", base);
  return { side, gate, tier, waitAt: side.runner.runs.length };
}

/** A named wait on `path`, an edit's work queued behind the tier in flight. */
async function wait(side: CatchUpSide, path: string): Promise<void> {
  await side.edit("watch", path.replace("test/", "src/"));
  await side.scheduler.promote([ref(path)], 60_000);
}

/** What the live daemon of `side` published for its tiers in flight. */
function standings(side: CatchUpSide) {
  const { store, worktreeId } = side;
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  return [...publishedYields(store, worktreeId, startedAt).values()];
}

describe("a tier past its estimate yields (spec 011 C4 step 5 as amended, row 011-107)", {
  timeout: 120_000,
}, () => {
  it("a tier already 30 s past a stale, short estimate yields at the promotion", async () => {
    const { side, gate, tier, waitAt } = await heldTier(5_000);

    clock.skew = 5_000 + YIELD_REMAINDER_MS;
    await wait(side, F);
    await expect.poll(() => tier.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    await expect.poll(() => side.current(F), { timeout: CUT_WITHIN_MS }).toBe(true);
    gate.stop();
    await side.scheduler.idle();

    expect(order(side, waitAt)).toEqual([[F], SLOW]);
  });

  it("a tier within its estimate keeps the remainder rule; 10 s past it, it waits for its bound", async () => {
    const { side, gate, tier } = await heldTier(20_000);

    await wait(side, F);
    await pause(SETTLE_MS);
    expect(standings(side)).toMatchObject([{ kind: "remainder" }]);
    expect(tier.cancelled).toBe(false);

    // A later check, 10 s past the 20 s estimate.
    clock.skew = 30_000;
    await side.edit("watch", "src/f.ts");
    await pause(SETTLE_MS);
    expect(standings(side)).toMatchObject([{ kind: "overrun" }]);
    expect(tier.cancelled).toBe(false);
    gate.stop();
    await side.scheduler.idle();

    expect(tier.completed).toHaveLength(4);
    const next = side.runner.runs[side.runner.runs.indexOf(tier) + 1];
    expect(next?.files.map((f) => f.path)).toEqual([F]);
  });

  it("a tier of files with no known duration does not yield, past its bound too (held until row 011-112)", async () => {
    // Row 011-112: a cut file of no known duration would share the named file's next tier
    // (`joinSpan` counts it 0, under `SHARE_FLOOR_MS`), so the named file would wait for it again.
    const policy = { baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-only" as const } };
    const { side, gate, tier } = await heldTier(200_000, [], policy);

    clock.skew = 2 * YIELD_REMAINDER_MS;
    await wait(side, F);
    await pause(SETTLE_MS);
    expect(tier.cancelled).toBe(false);
    expect(standings(side)).toMatchObject([{ kind: "remainder" }]);
    gate.stop();
    await side.scheduler.idle();

    const next = side.runner.runs[side.runner.runs.indexOf(tier) + 1];
    expect(next?.files.map((f) => f.path)).toEqual([F]);
  });

  it("a tier holding a file the overrun cut does not yield again at that key", async () => {
    const H = "test/h.test.ts";
    const { side, gate, tier: first, waitAt } = await heldTier(5_000, [H]);

    clock.skew = 5_000 + YIELD_REMAINDER_MS;
    await wait(side, F);
    await expect.poll(() => first.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
    // The cut files run again at their key, behind the named file.
    const second = await heldRun(side, SLOW[0] ?? "", side.runner.runs.indexOf(first) + 1);
    expect(order(side, waitAt)).toEqual([[F], SLOW]);

    // Past their bound again, with another wait behind them: the mark holds.
    clock.skew += 2 * YIELD_REMAINDER_MS;
    await wait(side, H);
    await pause(SETTLE_MS);
    expect(second.cancelled).toBe(false);
    expect(standings(side)).toEqual([{ kind: "cut" }]);
    gate.stop();
    await side.scheduler.idle();

    expect(second.completed).toHaveLength(4);
    expect([...SLOW, F, H].every((path) => side.current(path))).toBe(true);
  });
});
