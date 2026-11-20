/**
 * A daemon's mark is written again for an unchanged quiet demand at most this
 * often (row 011-424). A mark stays fresh for `SLOT_WAITER_FRESH_MS`, 30 s,
 * so one write in 5 s keeps it fresh with room for a late pump look.
 */
export const QUIET_DEMAND_WRITE_MS = 5_000;

/**
 * The backlog demand a lane's wait for quiet states in the daemon's pool
 * mark (spec 011 C4 step 5 and C10 as amended, row 011-424): the files the
 * wait holds, with no grant, so the other daemons' fair shares count them
 * before the wait ends. It holds what was stated last and when the mark
 * was last written for it; the pool writes the mark.
 */
export class QuietDemand {
  #want = 0;
  #writtenAt: number | null = null;

  /** The workers the wait states now; 0 states none. */
  get want(): number {
    return this.#want;
  }

  /**
   * The wait states `want` at `now`: true when the mark must be written for
   * it, because it changed or `QUIET_DEMAND_WRITE_MS` passed since the
   * last write of a demand above 0.
   */
  state(want: number, now: number): boolean {
    const wanted = Math.max(0, Math.floor(want));
    const unchanged = wanted === this.#want;
    if (unchanged && wanted === 0) return false;
    if (unchanged && this.#writtenAt !== null && now - this.#writtenAt < QUIET_DEMAND_WRITE_MS)
      return false;
    this.#want = wanted;
    this.#writtenAt = now;
    return true;
  }

  /** A tier asks: it states its own demand from now on (`PermitPool.acquire`). */
  end(): void {
    this.#want = 0;
    this.#writtenAt = null;
  }
}
