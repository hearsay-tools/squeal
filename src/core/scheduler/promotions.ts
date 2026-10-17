import { testFileId } from "../keys/index.js";
import type { TestFileRef } from "../types/index.js";

/**
 * One named wait's promotion (spec 011 C15): the test files it selected by
 * their own paths, by `testFileId`, until its deadline on the clock of
 * `Promotions`. `seq` orders the requests, the earlier first.
 */
interface Promotion {
  readonly files: ReadonlyMap<string, TestFileRef>;
  readonly until: number;
  readonly seq: number;
}

const NOT_RUNNING = (): boolean => false;

/**
 * The named waits' promotions of a `RunQueue` (spec 011 C15). Each lasts
 * until its deadline or until none of its files is queued or running (its
 * keys settled), whichever comes first. A file waiting on another
 * worktree's claim of its key is queued, so the promotion holds through the
 * claim (C7). In the daemon's memory only; a successor does not inherit
 * them.
 */
export class Promotions {
  #promotions: Promotion[] = [];
  #seq = 0;
  #now: () => number = Date.now;
  #isRunning: (ref: TestFileRef) => boolean = NOT_RUNNING;

  /** The clock deadlines are on, and whether a test file's run is in flight. */
  setClock(now: () => number, isRunning: (ref: TestFileRef) => boolean): void {
    this.#now = now;
    this.#isRunning = isRunning;
  }

  now(): number {
    return this.#now();
  }

  /** A wait's promotion of `refs` until `until`; none when no file of it is open. */
  add(refs: readonly TestFileRef[], until: number, queued: (id: string) => boolean): void {
    this.settle(queued);
    const files = new Map(refs.map((ref) => [testFileId(ref), ref]));
    const promotion = { files, until, seq: this.#seq++ };
    if (this.#open(promotion, queued)) this.#promotions.push(promotion);
  }

  /** The request order of the earliest live promotion of `id`; `null` when none holds it. */
  rankOf(id: string): number | null {
    if (this.#promotions.length === 0) return null;
    const now = this.#now();
    return this.#promotions.find((p) => p.until > now && p.files.has(id))?.seq ?? null;
  }

  /** Drops the promotions past their deadline or whose files all settled. */
  settle(queued: (id: string) => boolean): void {
    if (this.#promotions.length === 0) return;
    const now = this.#now();
    this.#promotions = this.#promotions.filter((p) => p.until > now && this.#open(p, queued));
  }

  clear(): void {
    this.#promotions = [];
  }

  #open(promotion: Promotion, queued: (id: string) => boolean): boolean {
    for (const [id, ref] of promotion.files) {
      if (queued(id) || this.#isRunning(ref)) return true;
    }
    return false;
  }
}
