import { describe, expect, it, vi } from "vitest";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { StepLive } from "../../src/core/scheduler/step-live.js";
import { TierYields } from "../../src/core/scheduler/yields.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { VirtualClock } from "../helpers/virtual-clock.js";
import { E, heldBatch } from "./batch-fixture.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Rows 011-366 and 011-372 (card 7, time as an input,
 * `research/scheduler-step.md`; review `reviews/0.1.518.md` S1): every
 * decision in a step's turn reads the step's one reading (`Turn.at`). The
 * scheduler's virtual clock counts its readings inside each
 * `StepLive.step`, moving `TICK_MS` at each, and names each by the frames
 * that took it. Past the step's own, a reading stays only where
 * `tasks/011-372/notes.md` names it: an action's timestamp or the wake
 * loop's bookkeeping. Before row 011-366 the yield check (`yields.ts:119`)
 * and the plan's view (`tier-live.ts:40`) read the clock themselves; before
 * row 011-372 beside selection (`beside.ts:36`, its batch order at `:51`),
 * the queue's batch rank (`RunQueue.hasFirstGroup`, `isCatchUp`, through
 * admission and `busyLanes`), adoption's read and the backlog tier's claim
 * read did.
 */

const TICK_MS = 7;

/** A reading that stays its own, by the frame that took it. */
const OWN_READS: Readonly<Record<string, RegExp>> = {
  // A tier's start: its row's and its run's start time.
  "tier start": /^(newTier|executeTier|startTier)\b/,
  // A row's write: the ledger's commit, a result's last-used time.
  "row write": /^(Ledger\.#write|acceptedAt)\b/,
  // The wake loop's bookkeeping: a wake's arm, the runner part's bound.
  "wake bookkeeping": /^(Wakes\.|RunnerPartBound\.)/,
};

/** Frames that only pass a reading on: the scheduler's `#now`, the promotions' clock, a transaction. */
const PASSING = /#now\b|^Promotions\.now\b|^(Connection|Object)\.transaction\b/;

/**
 * The names of the first two source frames that took a reading, innermost
 * first; an anonymous frame (a callback) is named by the function around it.
 */
function takers(stack: string): string[] {
  const names: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const frame = line.trim().replace(/^at /, "");
    if (!frame.includes("/src/core/")) continue;
    const name = frame.includes(" (") ? frame.slice(0, frame.indexOf(" (")) : frame;
    if (PASSING.test(name) || name.startsWith("/")) continue;
    names.push(name);
    if (names.length === 2) break;
  }
  return names;
}

/** One step's readings by what took them, and whether a yield check and a plan's order ran in it. */
interface Counted {
  readonly reads: string[];
  checks: number;
  plans: number;
}

/** Each step from now on: `"step"` for the step's own reading, an `OWN_READS` name, else the frames. */
function countSteps(clock: VirtualClock): Counted[] {
  const read = clock.now.bind(clock);
  const steps: Counted[] = [];
  let step: Counted | null = null;
  vi.spyOn(clock, "now").mockImplementation(() => {
    if (step === null) return read();
    clock.jump(TICK_MS);
    const [first = "?", second = ""] = takers(new Error().stack ?? "");
    const own = Object.entries(OWN_READS).find(([, site]) => site.test(first));
    step.reads.push(first === "StepLive.step" ? "step" : (own?.[0] ?? `${first} < ${second}`));
    return read();
  });
  const live = StepLive.prototype.step;
  vi.spyOn(StepLive.prototype, "step").mockImplementation(function (this: StepLive, ...args) {
    if (step !== null) return live.apply(this, args);
    const counted: Counted = { reads: [], checks: 0, plans: 0 };
    step = counted;
    try {
      return live.apply(this, args);
    } finally {
      step = null;
      steps.push(counted);
    }
  });
  const check = TierYields.prototype.check;
  vi.spyOn(TierYields.prototype, "check").mockImplementation(function (this: TierYields, ...a) {
    if (step !== null) step.checks += 1;
    check.apply(this, a);
  });
  const ordered = Ledger.prototype.ordered;
  vi.spyOn(Ledger.prototype, "ordered").mockImplementation(function (this: Ledger, ...a) {
    if (step !== null) step.plans += 1;
    return ordered.apply(this, a);
  });
  return steps;
}

/** The readings of `steps` past each step's first that no named site takes. */
const decisionReads = (steps: readonly Counted[]) =>
  steps.flatMap(({ reads }) => reads.filter((name, i) => i > 0 && !(name in OWN_READS)));

describe("every decision in a step's turn reads the step's one reading (rows 011-366, 011-372)", {
  timeout: 60_000,
}, () => {
  it("an edit's steps: its yield check and its plan read the step's; the rest are its tier's start, writes and wakes", async () => {
    const files: CatchUpFile[] = [
      { path: "test/a.test.ts", ms: 1, imports: ["src/a.ts"] },
      { path: "test/b.test.ts", ms: 1, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const options = { files, hostSlots: 4, policy: RUN_MISSING, clock: "virtual" } as const;
    const side = catchUpSide(repo, repo.main, options);
    await side.scheduler.start();
    await side.rest();
    const base = side.runner.runs.length;

    const steps = countSteps(side.clock as VirtualClock);
    await side.edit("watch", "src/a.ts");
    await side.rest();
    vi.restoreAllMocks();

    expect(side.runner.runs.length).toBeGreaterThan(base);
    // The revision's check in its pass, and the pump's plan that starts the edit's tier.
    expect([steps.some((s) => s.checks > 0), steps.some((s) => s.plans > 0)]).toEqual([true, true]);
    expect(steps.map(({ reads }) => reads[0])).toEqual(steps.map(() => "step"));
    expect(decisionReads(steps)).toEqual([]);
  });

  it("beside a running batch's tier: beside selection, the batch order and the batch rank read the step's", async () => {
    const { side, gate } = await heldBatch({ clock: "virtual" });

    const steps = countSteps(side.clock as VirtualClock);
    await side.edit("watch", "src/e.ts");
    await expect.poll(() => side.current(E), { timeout: 20_000 }).toBe(true);
    vi.restoreAllMocks();
    gate.stop();

    expect(steps.some((s) => s.plans > 0)).toBe(true);
    expect(steps.map(({ reads }) => reads[0])).toEqual(steps.map(() => "step"));
    expect(decisionReads(steps)).toEqual([]);
  });
});
