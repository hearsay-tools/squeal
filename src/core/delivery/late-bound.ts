import { wallEstimate } from "../scheduler/backlog.js";

/*
 * Row 005-93, part 1 (design section 1, decided by the human 2026-11-16): when the results for
 * a consumer's edits are late. The bound follows the machine and its normal load, never a
 * host-tuned number of seconds: this worktree's measured start delay, the scheduler's own wall
 * estimate of the owed files from their stored durations (`wallEstimate`) at the tier size and
 * widths the scheduler recorded, and its measured overhead per run, times a factor.
 */

/** The factor over the normal wait after which results are late: a ratio, not a time. */
export const LATE_FACTOR = 2;

/** One owed test file: its last-known run time (`null` when none is stored), width and part. */
export interface BoundFile {
  readonly ms: number | null;
  /** The workers its runner runs it with at the tier size (`RunnerTraits.tierWidth`). */
  readonly width: number;
  /** Its runner part (`RunnerTraits.tierPart`): parts in one tier run one after another. */
  readonly part: string;
}

/** What the bound reads: the owed files and this worktree's measured medians. */
export interface LateBoundInput {
  readonly files: readonly BoundFile[];
  /** Files per tier (`runner.tierSize`). */
  readonly tierSize: number;
  /** Median wait from an edit's revision to its first tier's start; 0 before any run. */
  readonly startMs: number;
  /** Median of an edit run's wall time minus the scheduler's estimate of it; 0 before any. */
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
 * One tier's wall estimate as the scheduler makes it: each part runs as wide as the narrowest
 * of its files' widths and no wider than its files, and the parts run one after another.
 */
export function tierEstimate(tier: readonly (BoundFile & { readonly ms: number })[]): number {
  const parts = new Map<string, { sum: number; longest: number; count: number; width: number }>();
  for (const f of tier) {
    const was = parts.get(f.part) ?? { sum: 0, longest: 0, count: 0, width: Infinity };
    parts.set(f.part, {
      sum: was.sum + f.ms,
      longest: Math.max(was.longest, f.ms),
      count: was.count + 1,
      width: Math.min(was.width, Math.max(1, Math.floor(f.width))),
    });
  }
  let total = 0;
  for (const p of parts.values())
    total += wallEstimate(p.sum, p.longest, Math.min(p.count, p.width));
  return total;
}

/**
 * `LATE_FACTOR × (start + Σ over tiers of (overhead + tierEstimate(tier)))`. The files are cut
 * into tiers of `tierSize`, shortest first, as the edit cut orders them. A file with no stored
 * duration counts the median of the known ones.
 */
export function lateBoundMs({ files, tierSize, startMs, overheadMs }: LateBoundInput): number {
  const fallback = median(files.flatMap((f) => (f.ms === null ? [] : [f.ms])));
  const ordered = files.map((f) => ({ ...f, ms: f.ms ?? fallback })).sort((a, b) => a.ms - b.ms);
  const size = Math.max(1, tierSize);
  let tiers = 0;
  for (let i = 0; i < ordered.length; i += size) {
    tiers += overheadMs + tierEstimate(ordered.slice(i, i + size));
  }
  return LATE_FACTOR * (startMs + tiers);
}
