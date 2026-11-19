import type { RelayOutcome } from "./relay-thread.js";

/*
 * Spec 021 D22.6 (row 021-36): how a daemon's code-store batches went, and
 * the daemon log's line of them, for the week's measurement.
 */

/** Why a batch was written here (D22.6). */
export type FallbackReason = "none" | "timeout" | "refused" | "failed" | "lost";

const REASONS: Readonly<Record<FallbackReason, string>> = {
  none: "none running",
  timeout: "timeout",
  refused: "refused schema",
  failed: "failed",
  lost: "lost",
};

/** How the daemon's batches went, for tests and the D22.6 measurement. */
export interface RelayCounts {
  /** Written by the store process. */
  sent: number;
  /** Written here: no store process took them, or none answered in the bound. */
  direct: number;
  /** Found written already by the mark when written here. */
  superseded: number;
  /** Not answered within the bound. */
  late: number;
  /** Not written at all, their callers told: a failed write here, or an earlier batch unsettled. */
  failed: number;
  /** The batches written here, by why. */
  readonly fallback: Record<FallbackReason, number>;
}

export const noFallback = (): Record<FallbackReason, number> => ({
  none: 0,
  timeout: 0,
  refused: 0,
  failed: 0,
  lost: 0,
});

/** Why a batch the thread did not get written there is written here. */
export function reasonOf(
  outcome: Exclude<RelayOutcome, "written"> | "late" | "busy",
): FallbackReason {
  switch (outcome) {
    case "late":
    case "busy":
      return "timeout";
    case "unknown":
      return "lost";
    default:
      return outcome;
  }
}

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
 * running 2, timeout 1, refused schema 0, failed 0, lost 0), 0 failed`. The
 * last count is the batches not written at all, their callers told.
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
