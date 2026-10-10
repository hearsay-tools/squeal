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
/** The longest a held answer keeps its discharges, whether or not it is read (task 001-226). */
export const HOLD_MS = 60 * 60_000;
/**
 * Why an answer that is not intact fails: the wait takes the fallback of a
 * daemon that cannot sync, any check's news and nothing pending at all,
 * never the edit window's quiet (task 001-226).
 */
export const INCOMPLETE_ANSWER =
  "the sync answer's discharges were released before it was read; its files may be incomplete";

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

/** A held answer's window, its deadline, and whether its discharges may be gone. */
interface Hold {
  readonly window: Window;
  readonly until: EpochMs;
  /** Ended before its answer was read, or a discharge it covers dropped before it was taken. */
  lost: boolean;
  /** Told once when the deadline ends it, so its answer fails then (task 001-229). */
  readonly expired: (() => void) | undefined;
}

/** What `Discharges.hold` returns to the answer that reads it. */
export interface HeldAnswer {
  /** Ends the hold, once the answer is read or failed; again, or after `forget`, is nothing. */
  release(): void;
  /** Ends the hold early: its answer will not be read (the socket forgot the request). */
  forget(): void;
  /**
   * At `now`, whether every discharge the window covers is still kept: the
   * hold was not ended early, forgotten or past its deadline, and none was
   * dropped before it was taken. An answer that is not intact may miss its
   * own news, and is not given (task 001-226).
   */
  intact(now: EpochMs): boolean;
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
 * landed. What a held answer covers is fixed by its window, and a hold
 * ends when its answer is read, when the socket forgets its request (one of
 * 32 it remembers), or after `HOLD_MS`, so the holds bound retention too
 * (review wave-13r B2, task 001-226): an answer whose hold ended before it
 * was read is not intact, and the wait falls back rather than ends quiet.
 * The deadline is kept by a timer for the earliest one, not by the next
 * call, so it ends on time while no discharge comes and the runner part the
 * answer waits for is stalled; it prunes at the deadline, so what was kept
 * only by age goes too (review wave-13s B2, task 001-229).
 */
export class Discharges {
  /** By file and revision, oldest discharge first. */
  readonly #kept = new Map<string, Discharge>();
  /** Oldest first. */
  readonly #held = new Set<Hold>();
  /** The latest time a call was given or a deadline passed, which an ended hold prunes at. */
  #latest: EpochMs | null = null;
  /** Due at the earliest deadline, or earlier; none while nothing is held. Never keeps the process alive. */
  #timer: { readonly at: EpochMs; readonly handle: ReturnType<typeof setTimeout> } | null = null;
  /** The latest time of a discharge a prune dropped: a window from before it may miss it. */
  #dropped: EpochMs | null = null;

  constructor(
    private readonly limits: DischargeLimits = {
      retentionMs: DISCHARGE_RETENTION_MS,
      cap: DISCHARGE_CAP,
    },
  ) {}

  get size(): number {
    return this.#kept.size;
  }

  /** The holds in force. */
  get holds(): number {
    return this.#held.size;
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
    this.#see(at);
    this.#expire(at);
    this.#prune(at);
  }

  /**
   * Keeps the discharges `since(since, after, upTo)` names, from `now` until
   * the answer's release, which a sync answer calls once read or failed, or
   * its forget, and for `HOLD_MS` at the latest (review wave-13r B2), when
   * `expired` is called, once, whatever else the daemon is doing (task
   * 001-229). Not after a release or forget.
   */
  hold(
    since: EpochMs,
    after: RevisionNumber,
    upTo: RevisionNumber,
    now: EpochMs,
    expired?: () => void,
  ): HeldAnswer {
    this.#see(now);
    this.#expire(now);
    const hold: Hold = {
      window: { since, after, upTo },
      until: now + HOLD_MS,
      lost: this.#dropped !== null && this.#dropped >= since,
      expired,
    };
    this.#held.add(hold);
    this.#arm(now);
    return {
      release: () => this.#end(hold, false),
      forget: () => this.#end(hold, true),
      intact: (at) => {
        this.#see(at);
        this.#expire(at);
        return !hold.lost;
      },
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

  /** Ends `hold`, `early` when its answer was not read; prunes what it alone kept. */
  #end(hold: Hold, early: boolean): void {
    if (!this.#held.delete(hold)) return;
    if (early) hold.lost = true;
    if (this.#held.size === 0 && this.#timer !== null) {
      clearTimeout(this.#timer.handle);
      this.#timer = null;
    }
    if (this.#latest !== null) this.#prune(this.#latest);
  }

  /** Releases, early, every hold past its deadline at `now`, and tells its answer. */
  #expire(now: EpochMs): void {
    for (const hold of [...this.#held]) {
      if (hold.until > now) continue;
      this.#end(hold, true);
      hold.expired?.();
    }
  }

  /** Due at the earliest deadline, from `now`; a timer due no later is left. */
  #arm(now: EpochMs): void {
    const at = Math.min(...[...this.#held].map((hold) => hold.until));
    if (this.#timer !== null) {
      if (this.#timer.at <= at) return;
      clearTimeout(this.#timer.handle);
    }
    const handle = setTimeout(() => {
      this.#timer = null;
      this.#see(at);
      this.#expire(at);
      if (this.#held.size > 0) this.#arm(at);
    }, at - now);
    handle.unref?.();
    this.#timer = { at, handle };
  }

  #see(at: EpochMs): void {
    this.#latest = Math.max(this.#latest ?? at, at);
  }

  #prune(now: EpochMs): void {
    for (const [key, discharge] of this.#kept) {
      if (this.#kept.size <= this.limits.cap && discharge.at >= now - this.limits.retentionMs) {
        return;
      }
      if (![...this.#held].some((hold) => covers(hold.window, discharge))) {
        this.#kept.delete(key);
        this.#dropped = Math.max(this.#dropped ?? discharge.at, discharge.at);
      }
    }
  }
}

function covers({ since, after, upTo }: Window, { revision, at }: Discharge): boolean {
  return at >= since && revision > after && revision <= upTo;
}
