import type { KeyIndex } from "../keys/index.js";
import type { CheckKey, EpochMs } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";

/**
 * How far each read reaches back before the previous one began. A result's
 * `recordedAt` is taken inside its storing transaction, after `BEGIN
 * IMMEDIATE` took the write lock, so a busy store's wait (task 001-422) comes
 * before it; a row commits after its time by its own transaction's length at
 * most. Cezar's records held the lock 11 to 67 s for a 198-file tier (task
 * 001-161), a commit of slots 55 to 340 ms (task 011-21); the margin over
 * them is `tasks/011-23/notes.md`'s.
 */
export const STORED_KEYS_OVERLAP_MS = 120_000;

/**
 * Spec 011 C4 step 3 as amended 2026-10-20 (task 011-23): "A file whose key
 * has no result here is looked up again when other worktrees store results:
 * each reconciliation pass and each tier selection read the keys recorded
 * since the last read, with an overlap for stores that commit late, and
 * settle this worktree's files at those keys as above."
 *
 * Each read takes the keys recorded since the previous read began, less
 * `STORED_KEYS_OVERLAP_MS` (`results_by_time`); a key read before at the same
 * newest time is not new. This worktree's files at a new key, with no result
 * there and neither running nor crashed there, settle through
 * `Ledger.settle` without queuing a miss: a hit is current with its
 * provenance, and a file policy left unqueued stays so. Another worktree's
 * unconfirmed fail stays held (C5) and its file is queued once, at its
 * normal priority, for the local run that confirms or clears it (C4 step 3
 * as amended 2026-10-23, row 011-159). A read that finds nothing new writes
 * nothing (task 001-412).
 *
 * Its files match at the formats C3 reads as one too (C4 step 3 as amended
 * 2026-10-20, task 011-38): a row a daemon a release behind stores after the
 * upgrade is copied to the file's key by the lookup, which reads those
 * formats again for the files matched.
 */
export class StoredKeys {
  /** When the previous read began; at first, the scheduler's start, before its baseline's lookup. */
  #readAt: EpochMs;
  /** The keys the reads within the overlap returned, at their newest record time. */
  readonly #seen = new Map<CheckKey, EpochMs>();

  constructor(start: EpochMs) {
    this.#readAt = start;
  }

  /**
   * Settles this worktree's files at the keys stored since the last read, and
   * commits. A busy store's error leaves the ledger as the store holds it
   * (`Ledger.hold`) and the read to the next one (task 001-422).
   */
  adopt(context: SchedulerContext, ledger: Ledger): void {
    const since = this.#readAt - STORED_KEYS_OVERLAP_MS;
    const readAt = context.now();
    const fresh = context.store.results
      .keysSince(since)
      .filter(({ key, recordedAt }) => this.#seen.get(key) !== recordedAt);
    const keys = new Set(fresh.map(({ key }) => key));
    const { index } = context.keys;
    const refs =
      keys.size === 0
        ? []
        : [...ledger.files.values()]
            .filter((file) => withoutResult(file, keys, index))
            .map((f) => f.ref);
    if (refs.length > 0) {
      const restore = ledger.hold(refs);
      ledger.rereadFormats(refs);
      try {
        ledger.settle(refs, NOTHING_CHANGED, { queueMisses: false });
        ledger.commit();
      } catch (error) {
        restore();
        throw error;
      }
    }
    this.#readAt = readAt;
    for (const [key, at] of this.#seen) if (at <= since) this.#seen.delete(key);
    for (const { key, recordedAt } of fresh) this.#seen.set(key, recordedAt);
  }
}

/**
 * `file`'s key, or its key at a format read as one, is among `keys`, and it
 * holds no result there, nor runs or crashed there.
 */
function withoutResult(file: FileState, keys: ReadonlySet<CheckKey>, index: KeyIndex): boolean {
  const { key } = file;
  if (key === null || key === file.resultKey || key === file.runningKey) return false;
  if (key === file.unknownKey) return false;
  return keys.has(key) || (index.keysReadAsOne(key)?.keys.some((k) => keys.has(k)) ?? false);
}
