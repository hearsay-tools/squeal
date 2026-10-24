import type { CodeFile } from "../../types/code.js";
import type { EpochMs, FileHash, RelativePath, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo, CodeStore } from "../store/index.js";

/** Row 015-18 (review 0.1.283 S1): counts tried at one blob before the pass stops until it changes. */
export const COUNT_ATTEMPTS = 3;

/** The wait after each failed count but the last: the second try 5 s after the first, the third 60 s after it. */
export const RETRY_AFTER_MS: readonly number[] = [5_000, 60_000];

/** One path whose blob the counter failed on. */
export interface FailedCount {
  readonly blob: FileHash;
  /** Counts tried at this blob since the daemon started. */
  readonly attempts: number;
  /**
   * When the pass tries again; `null` once `COUNT_ATTEMPTS` are spent, and
   * then not until the file's blob changes or a daemon starts.
   */
  readonly retryAt: EpochMs | null;
  /** The counter's error, its first line. */
  readonly error: string;
  /**
   * The count that failed at this blob was a first count or a policy
   * recount's: a retry or an adopted count at this blob then seeds the
   * file's states with no transition, as that count would have (D5, D6;
   * review 0.1.293 B1). Absent for an edit's count, whose retry reports
   * its crossings.
   */
  readonly quiet?: true;
}

/** Each path whose last count failed. */
export type FailedCounts = Map<RelativePath, FailedCount>;

/**
 * Code meta `uncountable:<worktreeId>`: the worktree's `FailedCounts` as
 * one JSON object by path. A file at its record's blob with no `retryAt`
 * reads `unknown` (could not count); one with a retry due reads pending.
 */
export const uncountableKey = (worktreeId: WorktreeId) => `uncountable:${worktreeId}`;

/** Empty when none was written, or it does not read. */
export function readUncountable(meta: CodeMetaRepo, worktreeId: WorktreeId): FailedCounts {
  const text = meta.get(uncountableKey(worktreeId));
  if (text === null) return new Map();
  try {
    const record = JSON.parse(text) as Record<RelativePath, FailedCount>;
    return new Map(Object.entries(record));
  } catch {
    return new Map();
  }
}

/** Writes `failed` when it differs from the stored record; an empty one removes it. */
export function writeUncountable(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
  failed: FailedCounts,
): void {
  const key = uncountableKey(worktreeId);
  const text = failed.size === 0 ? null : JSON.stringify(Object.fromEntries(failed));
  if (meta.get(key) === text) return;
  if (text === null) meta.delete(key);
  else meta.set(key, text);
}

/** The paths whose retry is due at `now`. */
export function dueRetries(failed: FailedCounts, now: EpochMs): RelativePath[] {
  return [...failed].flatMap(([path, f]) => (f.retryAt !== null && f.retryAt <= now ? [path] : []));
}

/** Whether the pass may count `path` at `blob` now: no failure at that blob, or its retry is due. */
export function mayCount(
  failed: FailedCounts,
  path: RelativePath,
  blob: FileHash,
  now: EpochMs,
): boolean {
  const f = failed.get(path);
  return f === undefined || f.blob !== blob || (f.retryAt !== null && f.retryAt <= now);
}

/**
 * The record after one more failed count of a path at `blob`, by a pass
 * that is `quiet` or not; another blob starts again at one attempt, with
 * this pass's origin. The same blob keeps the origin of its first failure.
 */
export function failedAgain(
  previous: FailedCount | undefined,
  blob: FileHash,
  error: string,
  { now, quiet }: { readonly now: EpochMs; readonly quiet: boolean },
): FailedCount {
  const same = previous?.blob === blob;
  const attempts = same ? previous.attempts + 1 : 1;
  const wait = attempts < COUNT_ATTEMPTS ? RETRY_AFTER_MS[attempts - 1] : undefined;
  const origin = same ? previous.quiet === true : quiet;
  return {
    blob,
    attempts,
    retryAt: wait === undefined ? null : now + wait,
    error,
    ...(origin ? { quiet: true } : {}),
  };
}

/** Whether a count of `path` at `blob` seeds quietly: its failed count there was a quiet one (B1). */
export function seedsQuietly(failed: FailedCounts, path: RelativePath, blob: FileHash): boolean {
  const f = failed.get(path);
  return f !== undefined && f.blob === blob && f.quiet === true;
}

/** The earliest retry still to come, for the daemon's timer; `null` when none is. */
export function nextRetry(failed: FailedCounts): EpochMs | null {
  const times = [...failed.values()].flatMap((f) => (f.retryAt === null ? [] : [f.retryAt]));
  return times.length === 0 ? null : Math.min(...times);
}

/** A starting daemon's fresh budget: each failure due at `now`, no attempt spent. */
export function restartRetries(meta: CodeMetaRepo, worktreeId: WorktreeId, now: EpochMs): void {
  const failed = readUncountable(meta, worktreeId);
  for (const [path, f] of failed) failed.set(path, { ...f, attempts: 0, retryAt: now });
  writeUncountable(meta, worktreeId, failed);
}

/** `file`'s failure when its count at this blob failed `COUNT_ATTEMPTS` times; else `null`. */
export function spentFailure(
  failed: FailedCounts,
  file: { readonly path: RelativePath; readonly blob: FileHash },
): FailedCount | null {
  const f = failed.get(file.path);
  return f !== undefined && f.blob === file.blob && f.retryAt === null ? f : null;
}

/**
 * The readers' `unknown` files: each of `files` at the blob the counter
 * failed on at every attempt, with no count of that blob stored since (one
 * another worktree's pass made). Any other failed count reads pending.
 */
export function uncountableFiles(
  store: Pick<CodeStore, "meta" | "counts">,
  worktreeId: WorktreeId,
  files: readonly CodeFile[],
): Map<RelativePath, FailedCount> {
  const failed = readUncountable(store.meta, worktreeId);
  const spent = new Map<RelativePath, FailedCount>();
  if (failed.size === 0) return spent;
  for (const file of files) {
    const f = spentFailure(failed, file);
    if (f === null) continue;
    if (store.counts.get(file.blob, file.language, file.counterVersion) === null)
      spent.set(file.path, f);
  }
  return spent;
}
