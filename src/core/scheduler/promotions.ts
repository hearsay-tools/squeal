import { testFileId } from "../keys/index.js";
import {
  type EpochMs,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

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

/** A live promotion as `meta` holds it for status (task 011-13): its files by `testFileId`. */
export interface PublishedPromotion {
  readonly files: readonly string[];
  readonly until: EpochMs;
}

/**
 * The named waits' promotions of a `RunQueue` (spec 011 C15). Each lasts
 * until its deadline or until none of its files is queued or running (its
 * keys settled), whichever comes first. A file waiting on another
 * worktree's claim of its key is queued, so the promotion holds through the
 * claim (C7), but it makes no tier yield (`TierYields`, row 011-55). In the
 * daemon's memory only; a successor does not inherit them.
 */
export class Promotions {
  #promotions: Promotion[] = [];
  #seq = 0;
  #now: () => number = Date.now;
  #isRunning: (ref: TestFileRef) => boolean = NOT_RUNNING;
  #publish: ((live: readonly PublishedPromotion[]) => void) | null = null;

  /**
   * The clock deadlines are on, whether a test file's run is in flight, and
   * where each change of the live promotions is told (`publishPromotions`).
   */
  setClock(
    now: () => number,
    isRunning: (ref: TestFileRef) => boolean,
    publish?: (live: readonly PublishedPromotion[]) => void,
  ): void {
    this.#now = now;
    this.#isRunning = isRunning;
    this.#publish = publish ?? null;
  }

  now(): number {
    return this.#now();
  }

  /** A wait's promotion of `refs` until `until`; none when no file of it is open. */
  add(refs: readonly TestFileRef[], until: number, queued: (id: string) => boolean): void {
    let changed = this.#settle(queued);
    const files = new Map(refs.map((ref) => [testFileId(ref), ref]));
    const promotion = { files, until, seq: this.#seq++ };
    if (this.#open(promotion, queued)) {
      this.#promotions.push(promotion);
      changed = true;
    }
    if (changed) this.#told();
  }

  /** The request order of the earliest live promotion of `id`; `null` when none holds it. */
  rankOf(id: string): number | null {
    return this.#first(id)?.seq ?? null;
  }

  /**
   * The deadline of the earliest live promotion of `id`, when `rankOf` next
   * changes with no event; `null` when none holds it (row 011-184).
   */
  untilOf(id: string): number | null {
    return this.#first(id)?.until ?? null;
  }

  /** Drops the promotions past their deadline or whose files all settled. */
  settle(queued: (id: string) => boolean): void {
    if (this.#settle(queued)) this.#told();
  }

  /** The live promotions as now; the returned function puts them back as they were (`RunQueue.hold`). */
  hold(): () => void {
    const held = [...this.#promotions];
    return () => {
      const same =
        held.length === this.#promotions.length && held.every((p, i) => p === this.#promotions[i]);
      this.#promotions = [...held];
      if (!same) this.#told();
    };
  }

  clear(): void {
    if (this.#promotions.length === 0) return;
    this.#promotions = [];
    this.#told();
  }

  /** The earliest live promotion of `id`, in request order. */
  #first(id: string): Promotion | undefined {
    if (this.#promotions.length === 0) return undefined;
    const now = this.#now();
    return this.#promotions.find((p) => p.until > now && p.files.has(id));
  }

  /** `settle` without the telling; whether any promotion was dropped. */
  #settle(queued: (id: string) => boolean): boolean {
    if (this.#promotions.length === 0) return false;
    const now = this.#now();
    const before = this.#promotions.length;
    this.#promotions = this.#promotions.filter((p) => p.until > now && this.#open(p, queued));
    return this.#promotions.length !== before;
  }

  #told(): void {
    this.#publish?.(
      this.#promotions.map((p) => ({ files: [...p.files.keys()], until: p.until as EpochMs })),
    );
  }

  #open(promotion: Promotion, queued: (id: string) => boolean): boolean {
    for (const [id, ref] of promotion.files) {
      if (queued(id) || this.#isRunning(ref)) return true;
    }
    return false;
  }
}

/*
 * Task 011-13 (011 C15, "queued, promoted, behind ..."): promotion lives in
 * the daemon's memory, so the daemon publishes its live promotions in one
 * `meta` row per worktree, rewritten on each change and dropped when none is
 * left, for the named wait's reasons to read in their own transaction. The
 * row carries when it was written: one older than the live daemon is a
 * predecessor's, whose promotions its successor did not inherit. A deadline
 * is on the daemon's clock, the host's, as every time in the store is.
 */

/** `meta` key of `worktreeId`'s live promotions: `{ at, promotions }`. */
export function promotionsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("promotions", worktreeId);
}

/** Writes `worktreeId`'s live promotions as of `at`; none drops the row. */
export function publishPromotions(
  store: Store,
  worktreeId: WorktreeId,
  live: readonly PublishedPromotion[],
  at: EpochMs,
): void {
  const key = promotionsMetaKey(worktreeId);
  if (live.length === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ at, promotions: live }));
}

/**
 * The `testFileId`s a promotion of the daemon started at `daemonStartedAt`
 * holds at `now`; empty with no row, as from a daemon older than 011-13, or
 * with a predecessor's.
 */
export function promotedIds(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlySet<string> {
  const raw = store.meta.get(promotionsMetaKey(worktreeId));
  if (raw === null) return new Set();
  try {
    const { at, promotions } = JSON.parse(raw) as { at?: unknown; promotions?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt || !Array.isArray(promotions)) {
      return new Set();
    }
    const live = promotions.filter(
      (p): p is PublishedPromotion =>
        typeof p === "object" &&
        p !== null &&
        typeof p.until === "number" &&
        p.until > now &&
        Array.isArray(p.files),
    );
    return new Set(live.flatMap((p) => p.files.filter((f) => typeof f === "string")));
  } catch {
    return new Set();
  }
}
