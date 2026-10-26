import { describe, expect, it, vi } from "vitest";
import { publishedYieldRow, TierYields, yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import type { TestFileRef, TierYield } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-194 (spec 011 C4 step 5, C15 Rank): one reading of the clock
 * decides a tier's yield. 016-18's probe found a decision that read the
 * clock again after it ranked the tier's files (`model-scheduler.md`
 * finding 3, A, seed 60), the class of review `reviews/0.1.296-r2.md` B2.
 * Here the clock moves 60 s on every reading after the first within one
 * `TierYields.check`, and the decision must be the one its first reading
 * gives: what a clock that stands still decides.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const [A, S2, S3, S4] = SLOW.map((path) => ref(path)) as [
  TestFileRef,
  TestFileRef,
  TestFileRef,
  TestFileRef,
];
const p = ref("f/p.test.ts", "f");
const q = ref("g/q.test.ts", "g");
const STEP_MS = 60_000;

/**
 * The scheduler's clock (`SchedulerOptions.now`): it stands still from its
 * first reading, after the daemon registered, but for `advance`. Within a
 * check `nextCheck` frames, it moves `STEP_MS` on every reading after the
 * check's first.
 */
function decisionClock() {
  let at: number | null = null;
  let moving: "still" | "first" | "moves" = "still";
  let reads = 0;
  return {
    now(): number {
      at ??= Date.now();
      if (moving === "moves") at += STEP_MS;
      if (moving === "first") moving = "moves";
      reads += 1;
      return at;
    },
    reads: () => reads,
    move(): void {
      moving = "first";
    },
    stop(): void {
      moving = "still";
    },
  };
}

type Clock = ReturnType<typeof decisionClock>;

/** What one check decided: the standings published at its end, and its readings before it stored them. */
interface Decided {
  standings: TierYield[] | null;
  readsBeforeRow: number | null;
}

/** What the live daemon of `side` published for its tiers in flight. */
function standings(side: CatchUpSide): TierYield[] {
  const { store, worktreeId } = side;
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  return [...publishedYieldRow(store, worktreeId, startedAt).tiers.values()];
}

/** Runs the next `TierYields.check` of `side` on `clock` moving, and records what it decided. */
function nextCheck(side: CatchUpSide, clock: Clock): Decided {
  const decided: Decided = { standings: null, readsBeforeRow: null };
  const check = TierYields.prototype.check;
  const set = side.store.meta.set.bind(side.store.meta);
  let from: number | null = null;
  vi.spyOn(side.store.meta, "set").mockImplementation((key, value) => {
    if (from !== null && key === yieldsMetaKey(side.worktreeId))
      decided.readsBeforeRow ??= clock.reads() - from;
    set(key, value);
  });
  vi.spyOn(TierYields.prototype, "check").mockImplementationOnce(function (
    this: TierYields,
    ...args
  ) {
    from = clock.reads();
    clock.move();
    try {
      check.apply(this, args);
    } finally {
      clock.stop();
      from = null;
      decided.standings = standings(side);
    }
  });
  return decided;
}

/**
 * An edit's tier of the four slow files, `ms` each last time, held in
 * flight; P, re-keyed by its project's environment in the same revision,
 * queued behind it. With `beside`, Q of project g in a lane of its own,
 * held in flight in a tier of its own.
 */
async function heldTier(ms: number, clock: Clock, beside = false) {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: p.path, ms: 1, imports: ["src/p.ts"] },
    ...(beside ? [{ project: "g", path: q.path, ms, imports: ["src/q.ts"] }] : []),
  ];
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    policy: RUN_MISSING,
    now: clock.now,
    ...(beside ? { lane: (f) => (f.project === "g" ? "g" : "vitest") } : {}),
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  holdRuns(side.runner, (path) => SLOW.includes(path) || path === q.path);
  await side.edit("watch", "src/s.ts", "f.config.json", ...(beside ? ["src/q.ts"] : []));
  await heldRun(side, A.path, base);
  if (beside) await heldRun(side, q.path, base);
  return side;
}

describe("one clock reading decides a tier's yield (spec 011 C4 step 5, row 011-194)", {
  timeout: 120_000,
}, () => {
  it("016-18's seed 60: a 20 s tier, a wait on s4 and P; a later wait's decision does not cut s4", async () => {
    const clock = decisionClock();
    const side = await heldTier(20_000, clock);
    await side.scheduler.promote([S4, p], 120_000);
    // The tier has run 0 s: 20 s are left, not over 30 s, so P makes it yield at its bound only.
    expect(standings(side)).toEqual([{ kind: "remainder", remainderMs: 20_000 }]);

    const decided = nextCheck(side, clock);
    await side.scheduler.promote([S2, S3], 120_000);
    // On main: the remainder read 180 s on saw the tier 160 s past its estimate, and it cut s4.
    expect(decided.standings).toEqual([{ kind: "remainder", remainderMs: 20_000 }]);
  });

  it("R397: at 40 s, an earlier wait on A ranks first while P's promotion is decided: the tier stands named", async () => {
    const clock = decisionClock();
    const side = await heldTier(200_000, clock);
    side.advance(40_000);
    await side.scheduler.promote([A], 30_000);

    const decided = nextCheck(side, clock);
    await side.scheduler.promote([p], 60_000);
    // On main: P's rank read 60 s on was past P's own deadline, so nothing waited for the tier.
    expect(decided.standings).toEqual([{ kind: "named" }]);
  });

  it("one check reads the clock once for the decisions of both tiers in flight", async () => {
    const clock = decisionClock();
    const side = await heldTier(200_000, clock, true);
    side.advance(40_000);
    await side.scheduler.promote([A], 30_000);

    const decided = nextCheck(side, clock);
    await side.scheduler.promote([p], 60_000);
    expect(decided.standings).toEqual([{ kind: "named" }]);
    // The decisions' one reading, and the row's own `at`.
    expect(decided.readsBeforeRow).toBe(2);
  });
});
