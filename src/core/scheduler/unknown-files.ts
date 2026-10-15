import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import {
  type CheckKey,
  type EpochMs,
  type RelativePath,
  type RevisionNumber,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Task 001-403: why each test file is `unknown`, by the key it was marked at,
 * so status and an abandoned checkpoint name the file and its reason (spec
 * 001 D5, D12). The sink keeps a reason only on a file's known checks; a file
 * that never stored a result has none, and its reason was lost. One JSON row
 * per worktree; a file's entry stands while its key is the one it names.
 */

/** The most sample paths kept per file. */
export const UNKNOWN_SAMPLES_KEPT = 3;

/** The most files kept per worktree, newest first. */
export const UNKNOWN_FILES_KEPT = 256;

/** One file's entry. */
export interface UnknownFileRecord {
  readonly testFile: TestFileRef;
  /** The key it was marked `unknown` at; `null` for an unkeyed file. */
  readonly key: CheckKey | null;
  readonly reason: string;
  /** Its run completed but stored nothing (inputs that never held still), as against no run ending. */
  readonly ran: boolean;
  /** A few of the paths that moved its key, when that is the reason. */
  readonly samples: readonly RelativePath[];
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
}

export function unknownFilesMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("unknownFiles", worktreeId);
}

/** The worktree's entries by `testFileId`; empty when none or unreadable. */
export function readUnknownFiles(
  store: Store,
  worktreeId: WorktreeId,
): Map<string, UnknownFileRecord> {
  const raw = store.meta.get(unknownFilesMetaKey(worktreeId));
  if (raw === null) return new Map();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!Array.isArray(value)) return new Map();
  const entries = value.filter(isEntry);
  return new Map(entries.map((e) => [testFileId(e.testFile), e]));
}

/**
 * Writes `marked` over the stored entries, inside the caller's transaction.
 * An entry `stands` decides is kept; the newest `UNKNOWN_FILES_KEPT` stay.
 */
export function recordUnknownFiles(
  store: Store,
  worktreeId: WorktreeId,
  marked: readonly UnknownFileRecord[],
  stands: (entry: UnknownFileRecord) => boolean,
): void {
  const entries = readUnknownFiles(store, worktreeId);
  for (const entry of marked) {
    const id = testFileId(entry.testFile);
    entries.delete(id);
    entries.set(id, entry);
  }
  const kept = [...entries.values()].filter(stands).slice(-UNKNOWN_FILES_KEPT);
  store.meta.set(unknownFilesMetaKey(worktreeId), JSON.stringify(kept));
}

/** At most `UNKNOWN_SAMPLES_KEPT` of `paths`, sorted. */
export function samplesOf(paths: Iterable<RelativePath>): RelativePath[] {
  return [...new Set(paths)].sort().slice(0, UNKNOWN_SAMPLES_KEPT);
}

function isEntry(value: unknown): value is UnknownFileRecord {
  if (!isRecord(value) || !isRecord(value.testFile)) return false;
  return (
    typeof value.testFile.path === "string" &&
    typeof value.testFile.project === "string" &&
    (value.key === null || typeof value.key === "string") &&
    typeof value.reason === "string" &&
    typeof value.ran === "boolean" &&
    Array.isArray(value.samples) &&
    value.samples.every((p) => typeof p === "string") &&
    typeof value.revision === "number" &&
    typeof value.at === "number"
  );
}
