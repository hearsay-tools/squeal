import {
  createDaemonLoop,
  type DaemonLoop,
  type DaemonLoopOptions,
} from "../../src/core/daemon-loop/index.js";
import type { Rest } from "../../src/core/types/scheduler.js";
import { countCalls, type QuietOptions, quiet, RunnerCalls } from "../helpers/quiet-point.js";

/** A daemon loop with its runner calls counted and a quiet point (row 011-380 B7). */
export interface CountedLoop extends DaemonLoop {
  readonly calls: RunnerCalls;
  /** The scheduler's quiet point (`test/helpers/quiet-point.ts`); host clock only. */
  quiet(options?: QuietOptions): Promise<Rest>;
}

/** `createDaemonLoop(options)`, its runner through `countCalls`, plus `calls` and `quiet()`. */
export function countedLoop(options: DaemonLoopOptions): CountedLoop {
  const calls = new RunnerCalls();
  const loop = createDaemonLoop({ ...options, runner: countCalls(options.runner, calls) });
  const side = { rest: () => loop.scheduler.rest(), calls, clock: null };
  return Object.assign(loop, { calls, quiet: (o?: QuietOptions) => quiet(side, o) });
}
