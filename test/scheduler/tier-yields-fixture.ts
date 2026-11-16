import { setTimeout as turn } from "node:timers/promises";
import { expect } from "vitest";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { isBesideLane } from "../../src/core/types/runner.js";
import type { Rest } from "../../src/core/types/scheduler.js";
import { gatherAt } from "../helpers/quiet-point.js";
import type { CatchUpRun, CatchUpRunner, CatchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-51 (spec 011 C4 step 5 as amended 2026-10-21, `research/running-tier-yields.md`):
 * what the tests of a running tier's yield share. A test file here is one of
 * `catch-up-fixture.ts`; its `ms` is the last-known duration the yield's
 * remainder reads, and a held run stands for one that would take that long.
 */

export const ref = (path: string, project = ""): TestFileRef => ({ project, path });

/**
 * A cancel reaches a held run within this: the revision or promotion that
 * cancels it is handled under the scheduler's lock, which a loaded host can
 * hold for seconds (load 70 on 24 CPUs).
 */
export const CUT_WITHIN_MS = 30_000;

/**
 * A held run starts within this after the edit or request that queues it:
 * the revision's store work, its runner part and the grant, at load 70 on
 * 24 CPUs (review `reviews/0.1.237.md` S1: Vitest's default poll is 1 s).
 */
export const START_WITHIN_MS = 30_000;

/** A pause after which a cancel that was going to come has come, at the same load. */
export const SETTLE_MS = 1_500;

/**
 * Holds each run that holds a file `held` matches until its cancel or
 * `stop`; any other run opens the gate first, so it runs at once. A run
 * beside a named wait's batch (row 011-269), in its lane's second
 * instance, is held the same way, but one it does not hold runs at once
 * without opening the gate, so the batch's run stays held.
 */
export function holdRuns(runner: CatchUpRunner, held: (path: string) => boolean) {
  let on = true;
  const holds = (files: readonly TestFileRef[]) => on && files.some((f) => held(f.path));
  const beside = (run: CatchUpRun | undefined) => isBesideLane(run?.lane ?? "");
  runner.holdOf = (run) => (beside(run) && !holds(run.files) ? Promise.resolve() : undefined);
  runner.beforeRun = (files) => {
    if (holds(files)) runner.hold();
    else if (!beside(runner.runs.at(-1))) runner.release();
  };
  return {
    stop(): void {
      on = false;
      runner.release();
    },
  };
}

/** A settle that finds no quiet point in this long fails the test: a guard on the host's clock only. */
const SETTLE_LIMIT_MS = 20_000;

/**
 * `side`'s runner calls (row 011-378): a run or runner-part call that
 * starts or ends changes it, a run a test routes past `CatchUpRunner.runs`
 * (a remote lane's) included.
 */
const runsMark = (side: CatchUpSide) => side.calls.mark();

/**
 * Row 011-363: the quiet point of `sides` on their virtual clocks. Each
 * rests (`CatchUpSide.rest`); a rest sets a runner's run aside, so a run
 * that is not held, 0 ms of real time here, can end after it, and its
 * record follows. So the sides rest again until no runner call started or
 * ended from before their rests to one real timer turn after them (row
 * 011-378: `runsMark`). A run left in flight (a held one) does not hold
 * `settle`, as it holds `quiet` (`quiet-point.ts`). A record's
 * gather (`slot-gather`) is bookkeeping: time moves to it while no other
 * wake is due at or before it (row 011-368, review S1); no other wake fires
 * unless the test moves time. Returns the first side's last rest.
 */
export async function settle(...sides: CatchUpSide[]): Promise<Rest> {
  const limit = performance.now() + SETTLE_LIMIT_MS;
  for (;;) {
    // Taken before the rests: a run that starts or ends while another side rests is seen.
    const before = sides.map(runsMark).join(" ");
    const rests: Rest[] = [];
    for (const side of sides) rests.push(await restOf(side, limit));
    const gathers = sides.flatMap((side, i) => {
      const at = gatherAt(rests[i]);
      return at === null ? [] : [() => side.advance(Math.max(0, at - side.now()))];
    });
    if (gathers.length > 0) {
      for (const gather of gathers) gather();
      continue;
    }
    await turn(1);
    const first = rests[0];
    if (sides.map(runsMark).join(" ") === before && first !== undefined) return first;
    if (performance.now() > limit) throw new Error(`no quiet point in ${SETTLE_LIMIT_MS} ms`);
  }
}

async function restOf(side: CatchUpSide, limit: number): Promise<Rest> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no rest in ${SETTLE_LIMIT_MS} ms`)),
      Math.max(0, limit - performance.now()),
    );
  });
  try {
    return await Promise.race([side.rest(), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The run of `path` in flight once one has started after the `after` runs;
 * it is held there. On a virtual clock (row 011-363) it is read at the
 * side's quiet point, with no poll.
 */
export async function heldRun(side: CatchUpSide, path: string, after: number): Promise<CatchUpRun> {
  if (side.clock !== null) await settle(side);
  else
    await expect
      .poll(() => side.runner.runs.slice(after).some((r) => holds(r, path) && r.endedAt === null), {
        timeout: START_WITHIN_MS,
      })
      .toBe(true);
  const run = side.runner.runs.slice(after).find((r) => holds(r, path) && r.endedAt === null);
  if (run === undefined) throw new Error(`no run of ${path} in flight`);
  return run;
}

export function holds(run: CatchUpRun, path: string): boolean {
  return run.files.some((f) => f.path === path);
}

/** The paths of each run after the first `after`, in start order. */
export function order(side: CatchUpSide, after: number): string[][] {
  return side.runner.runs.slice(after).map((r) => r.files.map((f) => f.path));
}

/** How many runs after the first `after` completed `path`. */
export function completions(side: CatchUpSide, path: string, after: number): number {
  return side.runner.runs.slice(after).filter((r) => r.completed.some((f) => f.path === path))
    .length;
}

/** A pause of `ms`, after which the test reads what the scheduler did meanwhile. */
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
