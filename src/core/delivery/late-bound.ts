import { wallEstimate } from "../scheduler/backlog.js";

/*
 * Row 005-93, part 1 (design section 1, decided by the human 2026-11-16): when the results for
 * a consumer's edits are late. The bound follows the machine and its normal load, never a
 * host-tuned number of seconds: this worktree's measured start delay, the scheduler's own wall
 * estimate of the owed files from their stored durations (`wallEstimate`), and its measured
 * overhead per run, times a factor.
 */

/** The factor over the normal wait after which results are late: a ratio, not a time. */
export const LATE_FACTOR = 2;

/** What the bound reads: the owed files' stored durations and this worktree's medians. */
export interface LateBoundInput {
  /** One per owed test file, its last-known run time; `null` when none is stored. */
  readonly durations: readonly (number | null)[];
  /** Files per tier (`runner.tierSize`). */
  readonly tierSize: number;
  /** Median wait from an edit's revision to its first run's start; 0 before any run. */
  readonly startMs: number;
  /** Median of a run's wall time minus its wall estimate; 0 before any run. */
  readonly overheadMs: number;
}

/** The median of `values`; 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * `LATE_FACTOR × (start + Σ over tiers of (overhead + wallEstimate(tier)))`. The files are cut
 * into tiers of `tierSize`, shortest first, as the edit cut orders them; each tier runs one
 * worker per file. A file with no stored duration counts the median of the known ones.
 */
export function lateBoundMs({ durations, tierSize, startMs, overheadMs }: LateBoundInput): number {
  const known = durations.filter((d): d is number => d !== null);
  const fallback = median(known);
  const ordered = durations.map((d) => d ?? fallback).sort((a, b) => a - b);
  const size = Math.max(1, tierSize);
  let tiers = 0;
  for (let i = 0; i < ordered.length; i += size) {
    const tier = ordered.slice(i, i + size);
    const sum = tier.reduce((total, ms) => total + ms, 0);
    tiers += overheadMs + wallEstimate(sum, Math.max(...tier), tier.length);
  }
  return LATE_FACTOR * (startMs + tiers);
}
