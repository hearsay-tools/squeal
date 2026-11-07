import { SLOT_WAITER_FRESH_MS } from "../slow/index.js";
import {
  type EpochMs,
  type PoolGate,
  type PoolWait,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
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
  /** The daemon's log: one line at a wait's start and one at its grant. */
  readonly log: (line: string) => void;
  /** Writes the waits for status (`publishPoolWaits`); a throw is left to the next write. */
  readonly publish: (lanes: ReadonlyMap<string, PoolWait>, at: EpochMs) => void;
}

/** The waits of one daemon's lanes for the pool, kept by `TierCapacity` (row 011-309). */
export class PoolWaits {
  readonly #options: PoolWaitsOptions;
  readonly #lanes = new Map<string, { readonly wait: PoolWait; readonly last: number }>();
  /** When the row was last written; `null` before, or after a write that failed. */
  #publishedAt: number | null = null;
  /** The row may hold a wait: the last write had one, or failed. */
  #written = false;

  constructor(options: PoolWaitsOptions) {
    this.#options = options;
  }

  /** The pool refused `lane`'s tier at a look that read `gate`. */
  refused(lane: string, gate: PoolGate): void {
    const now = this.#options.now();
    const live = this.#live(lane, now);
    const wait: PoolWait = { ...gate, since: (live?.wait.since ?? now) as EpochMs };
    this.#lanes.set(lane, { wait, last: now });
    if (live === undefined) {
      this.#options.log(
        `the pool refused the ${laneName(lane)} lane's tier: it waits for CPU (${gateText(gate)}); ${ASKS_AGAIN}`,
      );
      this.#publish(now);
    } else if (this.#publishedAt === null || now - this.#publishedAt >= POOL_WAIT_REFRESH_MS) {
      this.#publish(now);
    }
  }

  /** The pool granted `lane`'s tier: its wait ends, logged with its seconds while it was live. */
  granted(lane: string): void {
    const now = this.#options.now();
    const live = this.#live(lane, now);
    if (!this.#lanes.delete(lane)) return;
    if (live !== undefined) {
      const seconds = Math.round((now - live.wait.since) / 1_000);
      this.#options.log(
        `the pool granted the ${laneName(lane)} lane's tier after ${seconds} s of waiting for CPU`,
      );
    }
    this.#publish(now);
  }

  /** The daemon's scheduler closes: its lanes wait no more, and the row goes. */
  close(): void {
    this.#lanes.clear();
    if (this.#written) this.#publish(this.#options.now());
  }

  #live(lane: string, now: number) {
    const entry = this.#lanes.get(lane);
    return entry !== undefined && now - entry.last <= SLOT_WAITER_FRESH_MS ? entry : undefined;
  }

  /** Writes the live waits; one whose daemon stopped looking leaves them. */
  #publish(now: number): void {
    for (const lane of [...this.#lanes.keys()])
      if (this.#live(lane, now) === undefined) this.#lanes.delete(lane);
    const waits = new Map([...this.#lanes].map(([lane, { wait }]) => [lane, wait]));
    try {
      this.#options.publish(waits, now as EpochMs);
      this.#publishedAt = now;
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
