import type { EpochMs, RekeyedTestFile, RevisionNumber, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";

/**
 * How long a discharge stays answerable to a wait that has not asked yet: a
 * wait's sync answer names discharges since the wait started (task 001-202).
 * One a held answer covers outlives it (task 001-214).
 */
export const DISCHARGE_RETENTION_MS = 60 * 60_000;
/**
 * At most this many discharges are kept, the oldest dropped first, whatever
 * the session's length, beside those a held answer covers (task 001-214).
 */
export const DISCHARGE_CAP = 10_000;

/** One key move of a file that had its result, or `unknown`, at `at`. */
interface Discharge {
  readonly id: string;
  readonly ref: TestFileRef;
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

/** What a sync answer reads: discharged at or after `since`, at revisions after `after` up to `upTo`. */
interface Window {
  readonly since: EpochMs;
  readonly after: RevisionNumber;
  readonly upTo: RevisionNumber;
}

export interface DischargeLimits {
  readonly retentionMs: number;
  readonly cap: number;
}

/**
 * Review wave 13k, S1 (task 001-196): the attribution a result, or
 * `unknown`, at a file's key discharged, so a wait whose sync answer comes
 * after it still names the file (`Scheduler.rekeyedSince`). Kept per file
 * and revision (review wave 13l, S1, task 001-202): a later move discharged
 * before the answer, a cached result's included, does not replace the
 * earlier one the wait's captured revision still covers. It never comes back
 * as `keyedAt`, which would hold a later growth's wait for a file that has
 * its result (003 wave-4.5 B1). Neither bound drops one an answer held
 * between its captured revision and its read still covers (review wave 13q,
 * S1, task 001-214): that answer would end quiet where its file's news
 * landed. What a held answer covers is fixed by its window, so the hold
 * bounds retention too.
 */
export class Discharges {
  /** By file and revision, oldest discharge first. */
  readonly #kept = new Map<string, Discharge>();
  readonly #held = new Set<Window>();
  /** The last discharge's time, which a released hold prunes at. */
  #latest: EpochMs | null = null;

  constructor(
    private readonly limits: DischargeLimits = {
      retentionMs: DISCHARGE_RETENTION_MS,
      cap: DISCHARGE_CAP,
    },
  ) {}

  get size(): number {
    return this.#kept.size;
  }

  /** `file`'s attribution is discharged at `at`; nothing when it had none. */
  note(file: FileState, at: EpochMs): void {
    if (file.keyedAt === null || file.lastKeyedAt === null) return;
    for (const revision of new Set([file.keyedAt, file.lastKeyedAt])) {
      const key = `${file.id}\0${revision}`;
      // Re-inserted, so the map stays in discharge order.
      this.#kept.delete(key);
      this.#kept.set(key, { id: file.id, ref: file.ref, revision, at });
    }
    this.#latest = at;
    this.#prune(at);
  }

  /**
   * Keeps the discharges `since(since, after, upTo)` names until the
   * returned release, which a sync answer calls once read or failed.
   */
  hold(since: EpochMs, after: RevisionNumber, upTo: RevisionNumber): () => void {
    const window: Window = { since, after, upTo };
    this.#held.add(window);
    return () => {
      if (this.#held.delete(window) && this.#latest !== null) this.#prune(this.#latest);
    };
  }

  forget(id: string): void {
    for (const [key, discharge] of this.#kept) {
      if (discharge.id === id) this.#kept.delete(key);
    }
  }

  /** Files discharged at or after `since`, at their revisions after `after` up to `upTo`. */
  since(since: EpochMs, after: RevisionNumber, upTo: RevisionNumber): RekeyedTestFile[] {
    const files: RekeyedTestFile[] = [];
    const window = { since, after, upTo };
    for (const discharge of this.#kept.values()) {
      if (covers(window, discharge)) {
        files.push({ testFile: discharge.ref, revision: discharge.revision, resolved: true });
      }
    }
    return files;
  }

  #prune(now: EpochMs): void {
    for (const [key, discharge] of this.#kept) {
      if (this.#kept.size <= this.limits.cap && discharge.at >= now - this.limits.retentionMs) {
        return;
      }
      if (![...this.#held].some((window) => covers(window, discharge))) this.#kept.delete(key);
    }
  }
}

function covers({ since, after, upTo }: Window, { revision, at }: Discharge): boolean {
  return at >= since && revision > after && revision <= upTo;
}
