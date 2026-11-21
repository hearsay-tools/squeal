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
 * The workers a backlog tier's fair shares divide (spec 011 C10 as amended,
 * row 011-424): the permits the ceiling admits on an idle host, its busy
 * CPUs rounded up, at most `hostSlots` and at least 1. One daemon alone
 * gets what the gate gave it before (`gatedPermits` takes a permit while the
 * cores are below the ceiling). Two daemons' shares fill the ceiling
 * together: 5 + 4 of 9, where shares of the 11 slots gave 6, and the gate
 * left the second 3 (`research/simultaneous-demand.md`).
 *
 * `least`, the most workers a demand's tier runs no fewer than (row
 * 011-97), raises it, at most to the slots (review 0.1.584 B1): a share
 * below a tier's fewest workers never starts it, so on a ceiling below them
 * the pool's floor (021 D18), which serves the oldest waiter its fewest
 * workers while no background tier runs, would be refused for ever.
 */
export function backlogShareSlots(ceiling: number, hostSlots: number, least = 1): number {
  return Math.max(1, Math.min(hostSlots, Math.max(Math.ceil(ceiling), least)));
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
