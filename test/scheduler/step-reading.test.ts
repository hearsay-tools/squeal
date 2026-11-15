import { describe, expect, it, vi } from "vitest";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { StepLive } from "../../src/core/scheduler/step-live.js";
import { TierYields } from "../../src/core/scheduler/yields.js";
import type { EpochMs } from "../../src/core/types/common.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type VirtualClock, virtualClock } from "../helpers/virtual-clock.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-366 (card 7, slice S7 of `quality/2026-11-15-card-7.md`; time as
 * an input, `research/scheduler-step.md`): the step's one reading
 * (`Turn.at`) reaches the yield check and the fast plan. On a virtual
 * clock that moves `TICK_MS` on every reading, any second reading inside
 * a step differs from the step's; each yield check and each plan's queue
 * order inside a step must read the step's own. Before the row, the check
 * read the clock itself (`yields.ts:119`) and the plan's view took another
 * reading (`tier-live.ts:40`).
 */

const TICK_MS = 7;

/** One step of the live adapter: its reading, and what the check and the plan read inside it. */
interface Seen {
  at: number | null;
  readonly checks: (number | undefined)[];
  readonly plans: (number | undefined)[];
}

/** A prompt virtual clock that moves `TICK_MS` on every reading while `ticking`, and notes the step's first. */
function tickingClock() {
  const clock = virtualClock(Date.now() as EpochMs, { prompt: true });
  const state = { ticking: false, step: null as Seen | null };
  const ticking: VirtualClock = {
    now: () => {
      if (state.ticking) clock.jump(TICK_MS);
      const at = clock.now();
      if (state.step !== null && state.step.at === null) state.step.at = at;
      return at;
    },
    arm: (ms, fire) => clock.arm(ms, fire),
    advance: (ms) => clock.advance(ms),
    jump: (ms) => clock.jump(ms),
    get armed() {
      return clock.armed;
    },
  };
  return { clock: ticking, state };
}

/** Each step from now on, with the readings its yield check and its plan's order took. */
function watchSteps(state: { step: Seen | null }): Seen[] {
  const steps: Seen[] = [];
  const live = StepLive.prototype.step;
  vi.spyOn(StepLive.prototype, "step").mockImplementation(function (this: StepLive, ...args) {
    const seen: Seen = { at: null, checks: [], plans: [] };
    state.step = seen;
    try {
      return live.apply(this, args);
    } finally {
      state.step = null;
      steps.push(seen);
    }
  });
  const check = TierYields.prototype.check;
  vi.spyOn(TierYields.prototype, "check").mockImplementation(function (this: TierYields, ...args) {
    state.step?.checks.push(args[5]);
    check.apply(this, args);
  });
  const ordered = Ledger.prototype.ordered;
  vi.spyOn(Ledger.prototype, "ordered").mockImplementation(function (this: Ledger, ...args) {
    state.step?.plans.push(args[1]);
    return ordered.apply(this, args);
  });
  return steps;
}

describe("the step's one reading reaches the yield check and the fast plan (row 011-366, S7)", () => {
  it("on a clock that moves at every reading, an edit's check and plan read the step's reading", async () => {
    const files: CatchUpFile[] = [
      { path: "test/a.test.ts", ms: 1, imports: ["src/a.ts"] },
      { path: "test/b.test.ts", ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const { clock, state } = tickingClock();
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING, clock });
    await side.scheduler.start();
    await side.rest();
    const base = side.runner.runs.length;

    const steps = watchSteps(state);
    state.ticking = true;
    await side.edit("watch", "src/a.ts");
    await side.rest();
    state.ticking = false;
    vi.restoreAllMocks();

    expect(side.runner.runs.length).toBeGreaterThan(base);
    const checks = steps.filter((s) => s.checks.length > 0);
    const plans = steps.filter((s) => s.plans.length > 0);
    // The revision's check in its pass, and the pump's plan that starts the edit's tier.
    expect([checks.length > 0, plans.length > 0]).toEqual([true, true]);
    for (const s of [...checks, ...plans])
      expect([...s.checks, ...s.plans]).toEqual([...s.checks, ...s.plans].map(() => s.at));
  });
});
