import type { FileState } from "./files.js";

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
  /** Its files are ones a yield cut past their estimate (`CutFiles`, row 011-112). */
  readonly cut: boolean;
}

/** The files a yield cut past their tier's estimate, as tier selection reads them (row 011-112). */
export interface CutFiles {
  /**
   * A yield cut `file` at its current key once its tier had run past its
   * estimate (C4 step 5, row 011-107), and no result landed there since.
   */
  cutPastEstimate(file: FileState): boolean;
}

/** No file was cut. */
export const NONE_CUT: CutFiles = { cutPastEstimate: () => false };

/**
 * The span with a file of last-known time `durationMs` added, or `null` when
 * it must wait for a tier of its own (D5 step 5 as amended, task 001-184;
 * lessons, defect 31). A tier stores its results when it ends, so a 20 ms
 * edited file waited 187 s for a backlog file beside it. A file of no known
 * duration counts 0, as in the backlog budget: it shares only with files
 * under the floor, so a test file just written is never held by a slow one.
 *
 * A file a yield `cut` past its tier's estimate shares only with files so
 * cut, and they with it (row 011-112): its last-known time proved short and
 * it runs again from its start, so the file the tier yielded to would wait
 * for it once more. A file the remainder rule cut still has a last-known
 * time over 30 s, which keeps it from a file under a quarter of that.
 */
export function joinSpan(
  span: TierSpan | null,
  durationMs: number | null,
  cut = false,
): TierSpan | null {
  if (span !== null && span.cut !== cut) return null;
  const time = durationMs ?? 0;
  const fastest = Math.min(span?.fastest ?? time, time);
  const slowest = Math.max(span?.slowest ?? time, time);
  const shares = slowest <= Math.max(SHARE_FLOOR_MS, SHARE_RATIO * fastest);
  return shares ? { fastest, slowest, cut } : null;
}
