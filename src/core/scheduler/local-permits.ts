import { setTimeout as sleep } from "node:timers/promises";
import type { PoolLease } from "../capacity/pool.js";
import type { LocalPermits } from "../types/runner.js";
import {
  CAPACITY_RECHECK_MS,
  type TierCapacity,
  WAIT_FOR_CAPACITY,
  widthLease,
} from "./capacity.js";

/**
 * Spec 021 D18, last bullet (row 021-21; the coordinator, request
 * 66d23a73): a leased background tier's permits as its run sees them
 * (`RunOptions.permits`). A run the remote lane sends to another machine
 * gives them back, so a remote run holds no local permit. One that comes
 * back to run here (D13 `whenLost: "local"`) waits for permits again as a
 * backlog tier does, refused while the pool or its ceiling says so, at most
 * the grant it gave back and no fewer than `least`. A pool that fails costs
 * the run nothing: it runs at that grant, as a tier runs ungranted.
 */
export class TierPermits implements LocalPermits {
  readonly #capacity: TierCapacity;
  readonly #least: number;
  readonly #recheckMs: number;
  #lease: PoolLease | null;
  /** The grant given back by `away`; `null` while the tier holds its permits. */
  #gaveBack: number | null = null;
  /** `#lease` was taken by `back`, not the tier's own. */
  #again = false;

  constructor(
    capacity: TierCapacity,
    lease: PoolLease,
    least: number,
    recheckMs = CAPACITY_RECHECK_MS,
  ) {
    this.#capacity = capacity;
    this.#lease = lease;
    this.#least = least;
    this.#recheckMs = recheckMs;
  }

  /** What the tier holds now, which its tail shrinks; `null` while its run is away. */
  get lease(): PoolLease | null {
    return this.#lease;
  }

  away(): void {
    if (this.#lease === null) return;
    this.#gaveBack = this.#lease.grant;
    this.#lease.release();
    this.#lease = null;
  }

  async back(signal?: AbortSignal): Promise<number | null> {
    const want = this.#gaveBack;
    if (want === null) return this.#lease?.grant ?? null;
    while (signal?.aborted !== true) {
      const taken = this.#capacity.take(want, "fast", Math.min(want, this.#least), "backlog");
      if (taken === null) return want;
      if (taken !== WAIT_FOR_CAPACITY) {
        this.#lease = widthLease(taken, want);
        this.#gaveBack = null;
        this.#again = true;
        return taken.grant;
      }
      await sleep(this.#recheckMs, undefined, signal === undefined ? {} : { signal }).catch(
        () => {},
      );
    }
    return null;
  }

  /** The run ended: what `back` took goes back; the tier's own lease is `endTier`'s. */
  release(): void {
    if (this.#again) this.#lease?.release();
  }
}
