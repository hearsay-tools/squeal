import type { PoolMark } from "./marks.js";

/*
 * Spec 021 D18 as amended 2026-11-11 (row 021-18): background tiers, the
 * backlog's and the baselines', take a permit only while the host's busy
 * CPUs are below a ceiling, a share of the CPUs the machine reports. When
 * no background tier of the user's daemons runs, the oldest waiting one
 * takes its fewest workers, so background work never stops. Edit tiers,
 * named waits, checkpoints and agents' own runs stay outside the ceiling.
 */

/** `capacity.backgroundShare`'s default (the human, 2026-11-11: "75% cpu can be a default"). */
export const DEFAULT_BACKGROUND_SHARE = 0.75;

/** `capacity.backgroundShare` is a number from 0 to 1. */
export function isBackgroundShare(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** The busy CPUs below which a background tier takes a permit: `share` of `cpus`, to 0.01. */
export function backgroundCeiling(share: number, cpus: number): number {
  return Math.round(share * cpus * 100) / 100;
}

/**
 * The permits a mark's background tiers hold. A mark from a release before
 * row 021-18 does not say, so its whole grant counts.
 */
export function backgroundOf(mark: PoolMark): number {
  return mark.background ?? mark.grant;
}

/** What the CPU gate read when the ceiling refused a background tier, for the daemon's log. */
export interface CeilingRefusal {
  /** The cores the gate counted in use: the host's busy cores, or the marks' when more. */
  readonly busy: number;
  readonly ceiling: number;
  readonly share: number;
  readonly cpus: number;
  readonly hostSlots: number;
}

/**
 * `the background ceiling refused a backlog tier: 19.4 busy CPUs, ceiling 18
 * (0.75 of 24 CPUs)`; with fewer test slots than the ceiling, they bound it
 * and the line names them.
 */
export function ceilingRefusalLine(r: CeilingRefusal): string {
  const slots = r.hostSlots < r.ceiling ? `, ${r.hostSlots} test slots` : "";
  const ceiling = `ceiling ${round(r.ceiling)} (${r.share} of ${r.cpus} CPUs${slots})`;
  return `the background ceiling refused a backlog tier: ${round(r.busy)} busy CPUs, ${ceiling}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
