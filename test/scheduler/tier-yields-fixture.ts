import { expect } from "vitest";
import type { TestFileRef } from "../../src/core/types/index.js";
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

/** A pause after which a cancel that was going to come has come, at the same load. */
export const SETTLE_MS = 1_500;

/**
 * Holds each run that holds a file `held` matches until its cancel or
 * `stop`; any other run opens the gate first, so it runs at once.
 */
export function holdRuns(runner: CatchUpRunner, held: (path: string) => boolean) {
  let on = true;
  runner.beforeRun = (files) => {
    if (on && files.some((f) => held(f.path))) runner.hold();
    else runner.release();
  };
  return {
    stop(): void {
      on = false;
      runner.release();
    },
  };
}

/** The run of `path` in flight once one has started after the `after` runs; it is held there. */
export async function heldRun(side: CatchUpSide, path: string, after: number): Promise<CatchUpRun> {
  await expect
    .poll(() => side.runner.runs.slice(after).some((r) => holds(r, path) && r.endedAt === null))
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
