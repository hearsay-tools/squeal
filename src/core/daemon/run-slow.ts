import type { RunSlowResponse, Scheduler } from "../types/index.js";

/** What the scheduler queued for a `run-slow` request (spec 004 D2). */
export type SlowSuiteRequested = NonNullable<RunSlowResponse["requested"]>;

/** Message of a `run-slow` on a daemon whose scheduler has no slow tier. */
export const SLOW_NOT_SUPPORTED = "run --slow is not supported by this daemon";

/**
 * Hands `squeal run --slow` to the scheduler's `requestSlowSuite` (004-12).
 * A scheduler without the method rejects with `SLOW_NOT_SUPPORTED`.
 */
export function requestSlowSuite(scheduler: Scheduler): Promise<SlowSuiteRequested> {
  const slow = scheduler as Scheduler & {
    readonly requestSlowSuite?: () => Promise<SlowSuiteRequested>;
  };
  if (typeof slow.requestSlowSuite !== "function") {
    return Promise.reject(new Error(SLOW_NOT_SUPPORTED));
  }
  return slow.requestSlowSuite();
}
