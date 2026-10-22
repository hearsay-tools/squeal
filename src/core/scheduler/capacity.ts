import {
  createPermitPool,
  type PermitPool,
  type PoolLane,
  type PoolLease,
} from "../capacity/index.js";
import type { WorktreeId } from "../types/index.js";
import type { CapacityOptions } from "./options.js";

/** The tier may not start yet: no permit it may take is free. */
export const WAIT_FOR_CAPACITY = "wait";

/**
 * A daemon whose tier the pool refused looks again at least this often, and
 * when one of its tiers ends (011 C10 as amended 2026-10-21, row 011-96).
 */
export const CAPACITY_RECHECK_MS = 2_000;

/**
 * A scheduler's side of the per-user pool (spec 001 D11 Capacity, task
 * 001-376). Only backlog and checkpoint tiers ask; an edit's tier runs at
 * `runner.tierSize` without asking. A pool that fails (its directory refused
 * or gone) costs no tier: the tier runs without a grant, as with no pool,
 * and one note says why until the pool works again.
 */
export class TierCapacity {
  readonly #pool: PermitPool;
  readonly #dir: string;
  readonly #note: (message: string) => void;
  #failed: string | null = null;
  #refused = false;

  constructor(options: CapacityOptions, worktreeId: WorktreeId, note: (message: string) => void) {
    const { dir, refreshMs, hostSlots, project } = options;
    this.#dir = dir;
    this.#note = note;
    this.#pool = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId },
      ...(refreshMs === undefined ? {} : { refreshMs }),
      ...(hostSlots === undefined ? {} : { hostSlots }),
      ...(project === undefined ? {} : { project }),
    });
  }

  /**
   * The grant for a tier of `want` files that runs no fewer than `least`
   * workers (row 011-97); `null` when the pool failed and the tier runs
   * ungranted.
   */
  take(
    want: number,
    lane: PoolLane = "fast",
    least = 1,
  ): PoolLease | typeof WAIT_FOR_CAPACITY | null {
    try {
      const lease = this.#pool.acquire(want, lane, least);
      this.#failed = null;
      if (lease === null) this.#refused = true;
      return lease ?? WAIT_FOR_CAPACITY;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (this.#failed !== reason) {
        this.#note(
          `the capacity pool in ${this.#dir} failed (${reason}); tiers run without a grant`,
        );
      }
      this.#failed = reason;
      return null;
    }
  }

  /**
   * A tier was refused since the last call: its daemon is a waiter, and the
   * pump looks again within `CAPACITY_RECHECK_MS` (row 011-96).
   */
  refused(): boolean {
    const refused = this.#refused;
    this.#refused = false;
    return refused;
  }

  /**
   * A tier without a grant, an edit's, runs `workers` wide (row 011-98): the
   * daemon's mark states its CPU while it runs. It never waits; a pool that
   * fails costs it nothing. The function returned ends it.
   */
  running(workers: number): () => void {
    try {
      return this.#pool.running(workers);
    } catch {
      return () => {};
    }
  }

  /**
   * The grant a tier of `want` workers would get now, taking nothing (spec
   * 011 C4 step 5, task 001-366): what a backlog tier is budgeted at before
   * its files are picked. `want` when the pool fails, as `take` then runs
   * the tier ungranted.
   */
  offer(want: number): number {
    try {
      return this.#pool.offer(want);
    } catch {
      return want;
    }
  }

  close(): void {
    this.#pool.close();
  }
}

/**
 * A backlog tier's pool lease under its runner's width (task 001-366):
 * `startTier` keeps the workers of the files that start, at most `width`, so
 * a node:test tier of 9 files run 4 wide holds and states a demand of 4.
 */
export function widthLease(lease: PoolLease, width: number): PoolLease {
  return {
    get grant() {
      return lease.grant;
    },
    get permits() {
      return lease.permits;
    },
    shrinkTo: (files) => lease.shrinkTo(Math.min(files, width)),
    release: () => lease.release(),
  };
}

/**
 * A slow tier's pool lease counted in files: `startTier` keeps the workers
 * of the files that start, `perFile` (`slow.maxWorkers`) each.
 */
export function perFileLease(lease: PoolLease, perFile: number): PoolLease {
  return {
    get grant() {
      return lease.grant;
    },
    get permits() {
      return lease.permits;
    },
    shrinkTo: (files) => lease.shrinkTo(files * perFile),
    release: () => lease.release(),
  };
}
