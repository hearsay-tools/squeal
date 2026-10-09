/**
 * Last-known file time under which files always share an edit's tier (task
 * 001-184): a fast file waits at most this long for a tier mate, about three
 * runs' fixed cost on a loaded host (D4: 110 to 350 ms per run at idle).
 */
export const SHARE_FLOOR_MS = 1_000;

/**
 * Above the floor, a file shares an edit's tier only with files at most this
 * many times its last-known time, so its result waits at most that many of
 * its own runs for the slowest beside it (task 001-184).
 */
export const SHARE_RATIO = 4;

/** The last-known file times of the files an edit's tier has taken so far. */
export interface TierSpan {
  readonly fastest: number;
  readonly slowest: number;
}

/**
 * The span with a file of last-known time `durationMs` added, or `null` when
 * it must wait for a tier of its own (D5 step 5 as amended, task 001-184;
 * lessons, defect 31). A tier stores its results when it ends, so a 20 ms
 * edited file waited 187 s for a backlog file beside it. A file of no known
 * duration counts 0, as in the backlog budget: it shares only with files
 * under the floor, so a test file just written is never held by a slow one.
 */
export function joinSpan(span: TierSpan | null, durationMs: number | null): TierSpan | null {
  const time = durationMs ?? 0;
  const fastest = Math.min(span?.fastest ?? time, time);
  const slowest = Math.max(span?.slowest ?? time, time);
  return slowest <= Math.max(SHARE_FLOOR_MS, SHARE_RATIO * fastest) ? { fastest, slowest } : null;
}
