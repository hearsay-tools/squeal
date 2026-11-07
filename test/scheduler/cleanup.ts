import { afterEach } from "vitest";
import { storePaths } from "../../src/core/store/paths.js";
import { PhaseTrace, type TraceOptions } from "./phase-trace.js";

/** Real Vitest instances and real runs; a loaded machine needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

const cleanups: (() => Promise<void> | void)[] = [];
/** The tests' phase traces (row 011-281): a failed test's keeps its tmp dir and prints its report. */
const traces: PhaseTrace[] = [];

/** Registers `cleanup` to run after the test, before the ones registered earlier. */
export function onCleanUp(cleanup: () => Promise<void> | void): void {
  cleanups.push(cleanup);
}

/** Whether a phase trace of this test keeps `dir` for its report. */
export const keptByTrace = (dir: string): boolean => traces.some((trace) => trace.keeps(dir));

/** Runs the registered cleanups now, newest first; one that throws leaves the older ones registered. */
export async function cleanUp(): Promise<void> {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop())
    await cleanup();
}

// A scheduler's close waits for its run in flight and then closes Vitest: past
// the 10 s hook default under a loaded full suite (task 001-309).
afterEach(async (context) => {
  for (const trace of traces) {
    const report = context.task.result?.state === "fail" ? trace.failed() : null;
    if (report !== null) console.error(report);
  }
  try {
    await cleanUp();
  } finally {
    cleanups.length = 0;
    traces.length = 0;
  }
}, SLOW.timeout);

/** Within the 120 s test timeout, room for the stall report and the hook's own timeout. */
const TRACE_BUDGET_MS = 100_000;
/** Each traced cleanup step: three fit in the 120 s hook timeout. */
const TRACE_CLEANUP_MS = 30_000;

/** A phase trace for a test of `repo` (row 011-281); pass it as `HarnessOptions.trace`. */
export function traceRepo(
  repo: { dir: string; commonDir: string },
  options: Partial<Omit<TraceOptions, "kept">> = {},
): PhaseTrace {
  const { database, runsDir } = storePaths(repo.commonDir);
  const trace = new PhaseTrace({
    budgetMs: TRACE_BUDGET_MS,
    cleanupMs: TRACE_CLEANUP_MS,
    stall: null,
    ...options,
    kept: { dir: repo.dir, database, runsDir },
  });
  traces.push(trace);
  return trace;
}
