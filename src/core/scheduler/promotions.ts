import { testFileId } from "../keys/index.js";
import {
  type BatchPlace,
  type EpochMs,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/**
 * One named wait's batch (spec 011 C15 as amended 2026-10-29, row 011-268,
 * `research/named-wait-batches.md` Recommendation 1): the test files it
 * selected by their own paths, by `testFileId`, and its members, the files
 * of them that were queued or running and in no batch when it came. `seq`
 * orders the batches, the earlier first. Until the wait's deadline, on the
 * clock of `Promotions`, a selected file in no batch that is queued again
 * joins (an edit during the wait); after it, the batch only loses files.
 */
interface Promotion {
  readonly files: ReadonlyMap<string, TestFileRef>;
  readonly until: number;
  readonly seq: number;
  /** Each stays while it is queued or running: until its result is current, or it leaves the queue. */
  readonly members: ReadonlySet<string>;
  /** When its tier is estimated to end, while a file of it runs (`started`); `null` otherwise. */
  readonly estimatedEnd: EpochMs | null;
}

/**
 * C15's rank of a file at one reading of the clock: the order of its batch.
 * `until` was the deadline at which the rank lapsed with no event (row
 * 011-184); a batch does not lapse, so it is always `null` (row 011-268,
 * the coordinator's reply to request bdd8a1ed).
 */
export interface PromotionRank {
  readonly rank: number;
  readonly until: number | null;
}

const NOT_RUNNING = (): boolean => false;

/**
 * A live batch as `meta` holds it for status (task 011-13): the files its
 * wait selected, by `testFileId`, and its wait's deadline, as a reader
 * before row 011-268 reads them, a promotion until `until`. `batch` marks
 * a row of a daemon from row 011-268 on: the batch's own files, which live
 * past `until` until they settle, and the estimated end of its tier.
 */
export interface PublishedPromotion {
  readonly files: readonly string[];
  readonly until: EpochMs;
  readonly batch?: { readonly files: readonly string[]; readonly estimatedEnd: EpochMs | null };
}

/**
 * The named waits' batches of a `RunQueue` (spec 011 C15 as amended
 * 2026-10-29, row 011-268). A wait's selected files that are queued or
 * running and in no batch form a new batch at the end of the list; a wait
 * that finds none, as a re-wait of the same files does, forms none. A file
 * stays in its batch while it is queued or running, past the wait's
 * deadline, so a re-key during its run puts it back in the same batch; a
 * batch ends when its last file left. A file waiting on another worktree's
 * claim of its key is queued, so it stays through the claim (C7), but it
 * makes no tier yield (`TierYields`, row 011-55). In the daemon's memory
 * only; a successor does not inherit them.
 */
export class Promotions {
  #promotions: Promotion[] = [];
  #seq = 0;
  #now: () => number = Date.now;
  #isRunning: (ref: TestFileRef) => boolean = NOT_RUNNING;
  #publish: ((live: readonly PublishedPromotion[]) => void) | null = null;

  /**
   * The clock deadlines are on, whether a test file's run is in flight, and
   * where each change of the live batches is told (`publishPromotions`).
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

  /**
   * A wait's batch of `refs` until `until`: its open files in no batch. A
   * wait with none, as a re-wait of the same files, forms no batch, but is
   * kept until its deadline while a file of it is open, so a file of it
   * queued again meanwhile joins it (C15). None at all when no file of it
   * is open, or when `until` has passed: that wait has ended, and a CLI
   * sends no request then (task 011-11).
   */
  add(refs: readonly TestFileRef[], until: number, queued: (id: string) => boolean): void {
    let changed = this.#settle(queued);
    const files = new Map(refs.map((ref) => [testFileId(ref), ref]));
    const taken = this.#members();
    const open = [...files].filter(([id, ref]) => this.#isOpen(id, ref, queued));
    const members = new Set(open.map(([id]) => id).filter((id) => !taken.has(id)));
    if (until > this.#now() && open.length > 0) {
      this.#promotions.push({ files, until, seq: this.#seq++, members, estimatedEnd: null });
      changed = true;
    }
    if (changed) this.#told();
  }

  /** The order of the batch of `id`; `null` when none holds it. */
  rankOf(id: string): number | null {
    if (this.#promotions.length === 0) return null;
    return this.rankAt(id, this.#now())?.rank ?? null;
  }

  /**
   * `id`'s rank at `now`, a reading of this clock: its batch's order, or,
   * for a selected file in no batch, the first batch whose wait is open at
   * `now` and selected it, which it joins at the next settle; `null` when
   * none holds it. A decision reads every rank at one reading (row 011-184,
   * review `reviews/0.1.296-r2.md` B2).
   */
  rankAt(id: string, now: number): PromotionRank | null {
    const member = this.#promotions.find((p) => p.members.has(id));
    const first = member ?? this.#promotions.find((p) => p.until > now && p.files.has(id));
    return first === undefined ? null : { rank: first.seq, until: null };
  }

  /**
   * The batch whose order is `rank` started a tier estimated to end at
   * `estimatedEnd` (row 011-268): status names it.
   */
  started(rank: number, estimatedEnd: EpochMs): void {
    const at = this.#promotions.findIndex((p) => p.seq === rank);
    const promotion = this.#promotions[at];
    if (promotion === undefined || promotion.estimatedEnd === estimatedEnd) return;
    this.#promotions = this.#promotions.with(at, { ...promotion, estimatedEnd });
    this.#told();
  }

  /** Drops the files no longer queued or running, joins the reopened ones, ends the empty batches. */
  settle(queued: (id: string) => boolean): void {
    if (this.#settle(queued)) this.#told();
  }

  /** The live batches as now; the returned function puts them back as they were (`RunQueue.hold`). */
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

  /** `settle` without the telling; whether any batch changed. */
  #settle(queued: (id: string) => boolean): boolean {
    if (this.#promotions.length === 0) return false;
    const now = this.#now();
    const open = (p: Promotion, id: string) => {
      const ref = p.files.get(id);
      return ref !== undefined && this.#isOpen(id, ref, queued);
    };
    const kept = this.#promotions.map((p) => [...p.members].filter((id) => open(p, id)));
    const taken = new Set(kept.flat());
    let changed = false;
    const next: Promotion[] = [];
    this.#promotions.forEach((p, i) => {
      const members = new Set(kept[i]);
      // C15: a selected file queued again while the wait is open (an edit during it) joins.
      if (p.until > now)
        for (const id of p.files.keys())
          if (!taken.has(id) && open(p, id)) {
            members.add(id);
            taken.add(id);
          }
      // Status names a batch's estimated end only while a file of it runs (row 011-268).
      const runs = [...members].some((id) => {
        const ref = p.files.get(id);
        return ref !== undefined && this.#isRunning(ref);
      });
      const estimatedEnd = runs ? p.estimatedEnd : null;
      const same =
        estimatedEnd === p.estimatedEnd &&
        members.size === p.members.size &&
        [...members].every((id) => p.members.has(id));
      // A wait with no file of its own is kept while it is open and a file of it is (`add`).
      const lives =
        members.size > 0 || (p.until > now && [...p.files.keys()].some((id) => open(p, id)));
      changed ||= !same || !lives;
      if (lives) next.push(same ? p : { ...p, members, estimatedEnd });
    });
    this.#promotions = next;
    return changed;
  }

  #members(): Set<string> {
    return new Set(this.#promotions.flatMap((p) => [...p.members]));
  }

  #told(): void {
    this.#publish?.(
      this.#promotions.map((p) => ({
        files: [...p.files.keys()],
        until: p.until as EpochMs,
        batch: { files: [...p.members], estimatedEnd: p.estimatedEnd },
      })),
    );
  }

  #isOpen(id: string, ref: TestFileRef, queued: (id: string) => boolean): boolean {
    return queued(id) || this.#isRunning(ref);
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
  return new Set(publishedBatches(store, worktreeId, daemonStartedAt, now).keys());
}

/**
 * Each file `promotedIds` holds, with its batch's place (row 011-268): its
 * position among the live batches, their count, its files and its tier's
 * estimated end. A batch lives past its wait's deadline; an entry of a
 * daemon older than row 011-268 lives until its deadline and has no place
 * (`null`).
 */
export function publishedBatches(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlyMap<string, BatchPlace | null> {
  const raw = store.meta.get(promotionsMetaKey(worktreeId));
  const places = new Map<string, BatchPlace | null>();
  if (raw === null) return places;
  try {
    const { at, promotions } = JSON.parse(raw) as { at?: unknown; promotions?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt || !Array.isArray(promotions)) {
      return places;
    }
    const entries = promotions.filter(
      (p): p is PublishedPromotion =>
        typeof p === "object" &&
        p !== null &&
        typeof p.until === "number" &&
        Array.isArray(p.files),
    );
    // A wait with no file of its own is no batch (`Promotions.add`).
    const batches = entries.filter(
      (p) => typeof p.batch === "object" && p.batch !== null && (p.batch.files?.length ?? 0) > 0,
    );
    for (const p of entries) {
      const position = batches.indexOf(p) + 1;
      if (position === 0 && (p.batch !== undefined || p.until <= now)) continue;
      const own = position === 0 ? p.files : p.batch?.files;
      const files = Array.isArray(own) ? own.filter((f) => typeof f === "string") : [];
      const end = p.batch?.estimatedEnd;
      const place: BatchPlace | null =
        position === 0
          ? null
          : {
              position,
              of: batches.length,
              files: files.length,
              estimatedEnd: typeof end === "number" ? (end as EpochMs) : null,
            };
      for (const f of files) if (!places.has(f)) places.set(f, place);
    }
    return places;
  } catch {
    return places;
  }
}
