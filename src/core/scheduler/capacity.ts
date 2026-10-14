import { createPermitPool, type PermitPool, type PoolLease } from "../capacity/index.js";
import type { WorktreeId } from "../types/index.js";
import type { CapacityOptions } from "./options.js";

/** The tier may not start yet: the daemon's free worker is another lane's and no permit is free. */
export const WAIT_FOR_CAPACITY = "wait";

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

  /** The grant for a tier of `want` files; `null` when the pool failed and the tier runs ungranted. */
  take(want: number): PoolLease | typeof WAIT_FOR_CAPACITY | null {
    try {
      const lease = this.#pool.acquire(want);
      this.#failed = null;
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

  close(): void {
    this.#pool.close();
  }
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
