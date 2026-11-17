import { SLOT_WAITER_FRESH_MS } from "../slow/slot-files.js";
import type { EpochMs, WorktreeId } from "../types/common.js";
import type { PoolGate, PoolWait } from "../types/standing.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import type { CalendarSteps } from "./calendar-steps.js";
import { CAPACITY_RECHECK_MS } from "./capacity.js";

/*
 * Row 011-309 (spec 011 C10 Capacity and C15 "A batch on a busy host", as
 * amended 2026-11-07; `tasks/011-308/design.md` D2): a lane whose tier the
 * pool refused waits for CPU, and the daemon says so. The wait starts at the
 * first refusal and lasts while the refusals come no more than a waiter's
 * freshness apart (`SLOT_WAITER_FRESH_MS`, as the pool forgets a waiter that
 * stops looking); a grant in its lane ends it. The daemon's log gets one line
 * when it starts and one, with its seconds, when it is granted, none per
 * recheck. Status reads the waits from one `pool-wait` meta row of the
 * worktree, written when a wait starts or ends and at least every
 * `POOL_WAIT_REFRESH_MS` while one goes on, with the `quiet` row's liveness
 * rules: one older than the live daemon is a predecessor's, and one older
 * than the freshness is a daemon's that stopped looking.
 *
 * Row 011-389 (review 0.1.529): the wait counts its refresh, its freshness
 * and its grant's seconds on elapsed time (`PoolWaitsOptions.elapsed`), so a
 * calendar step neither keeps an old gate in the row, nor starts a new wait,
 * nor logs negative seconds. `since` and the row's `at` stay calendar times
 * for status, as row 011-377's owners keep stored stamps; a refusal after a
 * step writes the row again, so its `at` is fresh in today's calendar.
 *
 * Row 011-390 (review 0.1.531 S1): the step is the scheduler's
 * (`PoolWaitsOptions.steps`), whose sample brackets the calendar between two
 * elapsed readings and leaves an unsure one out, not a difference of this
 * owner's own two readings, which a thread pause between them moves.
 */

/** How often a wait that goes on writes its row again, with the pool's latest reading. */
export const POOL_WAIT_REFRESH_MS = 10_000;

/** `meta` key of `worktreeId`'s waits for the pool: `{ at, lanes }`, each lane's `PoolWait`. */
export function poolWaitMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("poolWait", worktreeId);
}

/** Writes `worktreeId`'s waits as of `at`; none drops the row. */
export function publishPoolWaits(
  store: Store,
  worktreeId: WorktreeId,
  lanes: ReadonlyMap<string, PoolWait>,
  at: EpochMs,
): void {
  const key = poolWaitMetaKey(worktreeId);
  if (lanes.size === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ at, lanes: Object.fromEntries(lanes) }));
}

/**
 * `PoolWaitsOptions.publish` for the daemon whose calendar steps are
 * `steps`: `publishPoolWaits`, stamped no earlier than the daemon's start
 * (`CalendarSteps.stamp`, row 011-386), so a write after a set-back past it
 * still reads as the live daemon's. Without `steps`, the reading.
 */
export function poolWaitsPublish(
  store: Store,
  worktreeId: WorktreeId,
  steps?: Pick<CalendarSteps, "stamp">,
): PoolWaitsOptions["publish"] {
  return (lanes, at) => publishPoolWaits(store, worktreeId, lanes, steps?.stamp(at) ?? at);
}

const NO_WAITS: ReadonlyMap<string, PoolWait> = new Map();

/**
 * Each lane's wait for the pool the daemon started at `daemonStartedAt`
 * published, as of `now`; none without a row, as from a daemon older than
 * row 011-309, with a predecessor's, or with one not written within
 * `SLOT_WAITER_FRESH_MS`. An entry without every field is left out.
 */
export function publishedPoolWaits(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlyMap<string, PoolWait> {
  const raw = store.meta.get(poolWaitMetaKey(worktreeId));
  if (raw === null) return NO_WAITS;
  try {
    const { at, lanes } = JSON.parse(raw) as { at?: unknown; lanes?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt || now - at > SLOT_WAITER_FRESH_MS)
      return NO_WAITS;
    if (typeof lanes !== "object" || lanes === null) return NO_WAITS;
    return new Map(
      Object.entries(lanes).filter((entry): entry is [string, PoolWait] => isPoolWait(entry[1])),
    );
  } catch {
    return NO_WAITS;
  }
}

function isPoolWait(value: unknown): value is PoolWait {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  const busy = w.busyCores;
  return (
    typeof w.since === "number" &&
    (busy === null || typeof busy === "number") &&
    typeof w.cpus === "number" &&
    typeof w.hostSlots === "number" &&
    typeof w.grants === "number"
  );
}

export interface PoolWaitsOptions {
  readonly now: () => number;
  /**
   * Row 011-389: elapsed time, which a calendar step does not move
   * (`Clock.elapsed`); without it, `now`.
   */
  readonly elapsed?: () => number;
  /**
   * Row 011-390: the calendar steps `now` tells (`steppedClock`); a step
   * since the last write writes the row again at once. Without it, none.
   */
  readonly steps?: Pick<CalendarSteps, "total">;
  /** The daemon's log: one line at a wait's start and one at its grant. */
  readonly log: (line: string) => void;
  /** Writes the waits for status (`publishPoolWaits`); a throw is left to the next write. */
  readonly publish: (lanes: ReadonlyMap<string, PoolWait>, at: EpochMs) => void;
}

/** The waits of one daemon's lanes for the pool, kept by `TierCapacity` (row 011-309). */
export class PoolWaits {
  readonly #options: PoolWaitsOptions;
  /** Each lane's wait, with its start (`began`) and its last refusal (`last`) in elapsed time. */
  readonly #lanes = new Map<
    string,
    { readonly wait: PoolWait; readonly began: number; readonly last: number }
  >();
  /** When the row was last written, in elapsed time; `null` before, or after a write that failed. */
  #publishedAt: number | null = null;
  /** `steps.total` at the last write: a change of it is a calendar step since. */
  #publishedSteps = 0;
  /** The row may hold a wait: the last write had one, or failed. */
  #written = false;

  readonly #elapsed: () => number;

  constructor(options: PoolWaitsOptions) {
    this.#options = options;
    this.#elapsed = options.elapsed ?? options.now;
  }

  /** The pool refused `lane`'s tier at a look that read `gate`. */
  refused(lane: string, gate: PoolGate): void {
    const now = this.#options.now();
    const elapsed = this.#elapsed();
    const live = this.#live(lane, elapsed);
    const wait: PoolWait = { ...gate, since: (live?.wait.since ?? now) as EpochMs };
    this.#lanes.set(lane, { wait, began: live?.began ?? elapsed, last: elapsed });
    if (live === undefined) {
      this.#options.log(
        `the pool refused the ${laneName(lane)} lane's tier: it waits for CPU (${gateText(gate)}); ${ASKS_AGAIN}`,
      );
      this.#publish(now, elapsed);
    } else if (
      this.#publishedAt === null ||
      elapsed - this.#publishedAt >= POOL_WAIT_REFRESH_MS ||
      this.#steps() !== this.#publishedSteps
    ) {
      this.#publish(now, elapsed);
    }
  }

  /** The pool granted `lane`'s tier: its wait ends, logged with its seconds while it was live. */
  granted(lane: string): void {
    const now = this.#options.now();
    const elapsed = this.#elapsed();
    const live = this.#live(lane, elapsed);
    if (!this.#lanes.delete(lane)) return;
    if (live !== undefined) {
      const seconds = Math.round((elapsed - live.began) / 1_000);
      this.#options.log(
        `the pool granted the ${laneName(lane)} lane's tier after ${seconds} s of waiting for CPU`,
      );
    }
    this.#publish(now, elapsed);
  }

  /** The daemon's scheduler closes: its lanes wait no more, and the row goes. */
  close(): void {
    this.#lanes.clear();
    if (this.#written) this.#publish(this.#options.now(), this.#elapsed());
  }

  /** The sum of the calendar steps told so far; 0 without `steps`. */
  #steps(): number {
    return this.#options.steps?.total ?? 0;
  }

  /** `lane`'s wait, if its last refusal is within the freshness at `elapsed`. */
  #live(lane: string, elapsed: number) {
    const entry = this.#lanes.get(lane);
    return entry !== undefined && elapsed - entry.last <= SLOT_WAITER_FRESH_MS ? entry : undefined;
  }

  /** Writes the live waits as of calendar `now`; one whose daemon stopped looking leaves them. */
  #publish(now: number, elapsed: number): void {
    for (const lane of [...this.#lanes.keys()])
      if (this.#live(lane, elapsed) === undefined) this.#lanes.delete(lane);
    const waits = new Map([...this.#lanes].map(([lane, { wait }]) => [lane, wait]));
    try {
      this.#options.publish(waits, now as EpochMs);
      this.#publishedAt = elapsed;
      this.#publishedSteps = this.#steps();
      this.#written = waits.size > 0;
    } catch {
      // A status row only: the next refusal or grant writes it again.
      this.#publishedAt = null;
      this.#written = true;
    }
  }
}

/** How often a refused daemon looks again, as the wait's line words it. */
export const ASKS_AGAIN = `the daemon asks again every ${CAPACITY_RECHECK_MS / 1_000} s`;

/** `21 of 24 cores in use; Squeal's daemons hold 7 of 12 test slots`, as the wait's line words it. */
export function gateText(gate: PoolGate): string {
  const cores =
    gate.busyCores === null
      ? ""
      : `${Math.min(gate.cpus, Math.round(gate.busyCores))} of ${gate.cpus} cores in use; `;
  return `${cores}Squeal's daemons hold ${gate.grants} of ${gate.hostSlots} test slots`;
}

function laneName(lane: string): string {
  return lane === "" ? "test" : lane;
}
