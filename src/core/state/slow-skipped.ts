import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  type SlowSkipRecord,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Spec 004 D8 as amended 2026-10-17 (task 004-65, review wave-8.1 B1): the
 * slow files an unmet precondition skipped, kept by the daemon in the store
 * apart from the tier's activity, which a run of other files replaces. Every
 * reader of the slow tier (headers, status, delivery, waits, `run --all` and
 * Stop) counts a file it lists as not run at this revision unless it is
 * queued again, so a result its key stored earlier never reads as current.
 */

/** `meta` key of a worktree's skipped slow files. */
export function slowSkipsMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("slowSkips", worktreeId);
}

/** Writes `skips`, none clearing the row. Writes only a change. */
export function publishSlowSkips(
  store: Store,
  worktreeId: WorktreeId,
  skips: readonly SlowSkipRecord[],
): void {
  const key = slowSkipsMetaKey(worktreeId);
  const next = skips.length === 0 ? null : JSON.stringify(skips);
  if (store.meta.get(key) === next) return;
  if (next === null) store.meta.delete(key);
  else store.meta.set(key, next);
}

/** The skips the daemon last kept; none when there are none or the row does not parse. */
export function readSlowSkips(store: Store, worktreeId: WorktreeId): SlowSkipRecord[] {
  const raw = store.meta.get(slowSkipsMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.flatMap(toSkip) : [];
  } catch {
    return [];
  }
}

/** The ids (`testFileId`) of every skipped slow file. */
export function skippedSlowIds(skips: readonly SlowSkipRecord[]): ReadonlySet<string> {
  return new Set(skips.flatMap((skip) => skip.testFiles.map(testFileId)));
}

function toSkip(value: unknown): SlowSkipRecord[] {
  if (!isRecord(value) || !isRecord(value.precondition)) return [];
  const { source, reason, since, testFiles } = value;
  if (typeof source !== "string" || typeof reason !== "string" || typeof since !== "number") {
    return [];
  }
  if (!Array.isArray(testFiles) || !testFiles.every(isRef)) return [];
  return [{ precondition: value.precondition, source, reason, since, testFiles }];
}

function isRef(value: unknown): value is TestFileRef {
  return isRecord(value) && typeof value.project === "string" && typeof value.path === "string";
}
