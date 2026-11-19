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
}

/**
 * `the background ceiling refused a backlog tier: 19.4 busy CPUs, ceiling 18
 * (0.75 of 24 CPUs)`. The test slots do not bound the ceiling, so the line
 * does not name them (row 011-404, gh-225).
 */
export function ceilingRefusalLine(r: CeilingRefusal): string {
  const ceiling = `ceiling ${round(r.ceiling)} (${r.share} of ${r.cpus} CPUs)`;
  return `the background ceiling refused a backlog tier: ${round(r.busy)} busy CPUs, ${ceiling}`;
}

/**
 * Row 011-404 (021-19 recommendation 4): the daemon's log has one refusal
 * line per refusal episode, not one per look. The first refused look of a
 * waiting backlog tier logs; later ones stay quiet until a backlog grant
 * ends the episode, with one line of its length, or until no refused look
 * came for `quietMs`, the wait's freshness: the next refusal starts a new
 * episode.
 */
export class RefusalEpisodes {
  readonly #log: (line: string) => void;
  readonly #quietMs: number;
  #episode: { readonly since: number; last: number; looks: number } | null = null;

  constructor(log: (line: string) => void, quietMs: number) {
    this.#log = log;
    this.#quietMs = quietMs;
  }

  /** A look the ceiling refused at `now`: `line` is logged at its episode's first. */
  refused(now: number, line: () => string): void {
    const episode = this.#episode;
    if (episode !== null && now - episode.last < this.#quietMs) {
      episode.last = now;
      episode.looks++;
      return;
    }
    this.#episode = { since: now, last: now, looks: 1 };
    this.#log(line());
  }

  /** A backlog tier got permits at `now`: an open episode ends with its length. */
  granted(now: number): void {
    const episode = this.#episode;
    this.#episode = null;
    if (episode === null || now - episode.last >= this.#quietMs) return;
    const seconds = Math.round((now - episode.since) / 1_000);
    const looks = episode.looks === 1 ? "1 refused look" : `${episode.looks} refused looks`;
    this.#log(`the background ceiling let a backlog tier start after ${seconds} s and ${looks}`);
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
