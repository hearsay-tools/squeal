import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Ledger } from "../../src/core/scheduler/ledger.js";
import { StepLive } from "../../src/core/scheduler/step-live.js";
import { TierYields } from "../../src/core/scheduler/yields.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import type { VirtualClock } from "../helpers/virtual-clock.js";
import { E, heldBatch } from "./batch-fixture.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { settle } from "./tier-yields-fixture.js";

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
 * read did, and in a slow lane its group's order, its quiet moment and its
 * claim check.
 */

const TICK_MS = 7;

/** A reading that stays its own, by the frames that took it (`taker < caller`). */
const OWN_READS: Readonly<Record<string, RegExp>> = {
  // A tier's start: its row's and its run's start time, a slow tier's too.
  "tier start": /^(newTier|executeTier|startTier|SlowTier\.#select)\b/,
  // A row's write: the ledger's commit, a result's last-used time, the pool wait's end.
  "row write": /^(Ledger\.#write|acceptedAt|PoolWaits\.(granted|refused))\b/,
  // The lock's label for a lock watcher: when the turn's operation began.
  "lock label": /^Mutex\.relabel\b/,
  // The wake loop's bookkeeping: a wake's arm, the runner part's bound, the slow release's arm.
  "wake bookkeeping": /^(Wakes\.|RunnerPartBound\.|SlowRelease\.#decide < SlowRelease\.arm\b)/,
};

/**
 * Frames that only pass a reading on: the scheduler's `#now`, its stepped
 * clock (row 011-377), the promotions' clock, a transaction.
 */
const PASSING =
  /#now\b|^SteppedClock\.now\b|^Promotions\.now\b|^(Connection|Object)\.transaction\b/;

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

/**
 * One step's readings by what took them; its own reading's value; the
 * readings its yield checks and its plans' queue orders were given.
 */
interface Counted {
  readonly reads: string[];
  at: number | null;
  readonly checks: (number | undefined)[];
  readonly plans: (number | undefined)[];
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
    const frames = `${first} < ${second}`;
    const own = Object.entries(OWN_READS).find(([, site]) => site.test(frames));
    step.reads.push(first === "StepLive.step" ? "step" : (own?.[0] ?? frames));
    const at = read();
    step.at ??= at;
    return at;
  });
  const live = StepLive.prototype.step;
  vi.spyOn(StepLive.prototype, "step").mockImplementation(function (this: StepLive, ...args) {
    if (step !== null) return live.apply(this, args);
    const counted: Counted = { reads: [], at: null, checks: [], plans: [] };
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
    step?.checks.push(a[5]);
    check.apply(this, a);
  });
  const ordered = Ledger.prototype.ordered;
  vi.spyOn(Ledger.prototype, "ordered").mockImplementation(function (this: Ledger, ...a) {
    step?.plans.push(a[1]);
    return ordered.apply(this, a);
  });
  return steps;
}

/** The readings of `steps` past each step's first that no named site takes. */
const decisionReads = (steps: readonly Counted[]) =>
  steps.flatMap(({ reads }) => reads.filter((name, i) => i > 0 && !(name in OWN_READS)));

/**
 * Each step's own reading first, no decision read after it, and each yield
 * check and plan given that reading's value (review 0.1.520 S1: a count
 * alone misses a constant passed on).
 */
function expectOneReading(steps: readonly Counted[]): void {
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.map(({ reads }) => reads[0])).toEqual(steps.map(() => "step"));
  expect(decisionReads(steps)).toEqual([]);
  const given = steps.flatMap((s) => [...s.checks, ...s.plans].map((at) => [at, s.at]));
  expect(given.filter(([at, own]) => at !== own)).toEqual([]);
}

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
    expect([steps.some((s) => s.checks.length > 0), steps.some((s) => s.plans.length > 0)]).toEqual(
      [true, true],
    );
    expectOneReading(steps);
  });

  /** Steps beside a held batch's tier and after its end; `paused`, the backlog paused (a departure drain). */
  async function besideSteps(paused: boolean): Promise<Counted[]> {
    const { side, gate } = await heldBatch({ clock: "virtual" });
    if (paused) side.scheduler.pauseBacklog(true);

    const steps = countSteps(side.clock as VirtualClock);
    await side.edit("watch", "src/e.ts");
    await expect.poll(() => side.current(E), { timeout: 20_000 }).toBe(true);
    // The batch's tier ends: the beside lane's close, then the backlog's tiers, ranked at each step.
    gate.stop();
    await settle(side);
    vi.restoreAllMocks();
    return steps;
  }

  it("beside a running batch's tier: beside selection, the batch order and the batch rank read the step's", async () => {
    const steps = await besideSteps(false);
    expect(steps.some((s) => s.plans.length > 0)).toBe(true);
    expectOneReading(steps);
  });

  it("with the backlog paused: the drain's filter of the plan's order reads the step's (review 0.1.520 B1)", async () => {
    const steps = await besideSteps(true);
    expect(steps.some((s) => s.plans.length > 0)).toBe(true);
    expectOneReading(steps);
  });

  it("a slow lane's steps: its listing, guard and pick read the step's", async () => {
    const files: CatchUpFile[] = [
      { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
      { path: "test/e2e/s1.test.ts", ms: 10, imports: ["src/core.ts"] },
      { path: "test/e2e/s2.test.ts", ms: 10, imports: ["src/core.ts"] },
    ];
    const repo = catchUpRepo(files);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-372-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const slow = { ...DEFAULT_POLICY.slow, include: ["test/e2e/**"], quietMs: 0, maxParallel: 2 };
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 8,
      policy: { ...RUN_MISSING, slow },
      scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
      clock: "virtual",
    });
    await side.scheduler.start();
    await settle(side);
    const base = side.runner.runs.length;

    const steps = countSteps(side.clock as VirtualClock);
    await side.edit("watch", "src/core.ts");
    await settle(side);
    vi.restoreAllMocks();

    const ran = side.runner.runs.slice(base).flatMap((run) => run.files.map((f) => f.path));
    expect(ran.toSorted()).toEqual(files.map((f) => f.path).toSorted());
    expectOneReading(steps);
  });
});
