/*
 * Spec 021 D22.6 (row 021-36): how a daemon's code-store batches went, and
 * the daemon log's line of them, for the week's measurement.
 */

/**
 * Why a batch was written here (D22.4, D22.6): no store process ran, it
 * refused the batch (another schema, or stopping), it was lost there (the
 * process died with it), or the process hung and was ended.
 */
export type FallbackReason = "none" | "refused" | "lost" | "hung";

const REASONS: Readonly<Record<FallbackReason, string>> = {
  none: "none running",
  refused: "refused",
  lost: "lost",
  hung: "hung and ended",
};

/**
 * How the daemon's batches went, for tests and the D22.6 measurement; each
 * batch is counted once, when its relay thread settled it.
 */
export interface RelayCounts {
  /** Written by the store process: it answered so, or its mark was found here (review of 0.1.571 B5). */
  sent: number;
  /** Written here: the store process's lock was free, or it refused the batch. */
  direct: number;
  /** Of `sent`, the ones whose answer was lost and whose mark was found here. */
  superseded: number;
  /** Written nowhere, their callers told: SQLite stayed busy past D1's bound, or the batch failed. */
  failed: number;
  /** The batches written here, by why. */
  readonly fallback: Record<FallbackReason, number>;
}

export const noFallback = (): Record<FallbackReason, number> => ({
  none: 0,
  refused: 0,
  lost: 0,
  hung: 0,
});

/** The counts a line was written at. */
export interface ReportedCounts {
  readonly sent: number;
  readonly failed: number;
  readonly fallback: Readonly<Record<FallbackReason, number>>;
}

export function snapshotOf(counts: RelayCounts): ReportedCounts {
  return { sent: counts.sent, failed: counts.failed, fallback: { ...counts.fallback } };
}

/**
 * The line of the batches since `was`, `null` with none: `code store: last
 * minute: 12 batches through the store process, 3 written here (none
 * running 2, refused 0, lost 1, hung and ended 0), 0 failed`. The last
 * count is the batches not written at all, their callers told.
 */
export function reportLine(counts: RelayCounts, was: ReportedCounts): string | null {
  const here = (Object.keys(REASONS) as FallbackReason[]).map(
    (why) => [why, counts.fallback[why] - was.fallback[why]] as const,
  );
  const direct = here.reduce((n, [, count]) => n + count, 0);
  const failed = counts.failed - was.failed;
  if (counts.sent === was.sent && direct === 0 && failed === 0) return null;
  const reasons = here.map(([why, count]) => `${REASONS[why]} ${count}`).join(", ");
  return (
    `code store: last minute: ${counts.sent - was.sent} batches through the store process, ` +
    `${direct} written here (${reasons}), ${failed} failed`
  );
}
