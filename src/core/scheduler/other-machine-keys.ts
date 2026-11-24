import { testFileId } from "../keys/reverse-index.js";
import type { ProjectName, RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Review 0.1.620-r2 S3 (row 026-19, spec 026 D9, D10): the key a run on
 * another machine than its key's stored a test file's results under, as
 * `storeOtherMachine` admitted them. The coverage of that run goes to this
 * key (`mainStoreResultKey`). A fact of result recording, never inferred
 * from the capped diagnostic history of `unknown-files.ts`. One JSON row per
 * worktree, one entry per test file: a newer run's entry replaces the file's,
 * and an entry goes once the file is at another key than the one it ran for.
 */

/** One test file's newest admitted run on another machine. */
export interface OtherMachineKey {
  readonly testFile: TestFileRef;
  readonly runId: string;
  /** The key the run was for, the file's current key when it ran; the file is `unknown` there. */
  readonly currentKey: CheckKey;
  /** The key its results were stored under: the machine it ran on. */
  readonly storedKey: CheckKey;
}

/** A row's entry: `[project, path, runId, currentKey, storedKey]`, compact for large worktrees. */
type Entry = [string, string, string, string, string];

export function otherMachineKeysMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("otherMachineKeys", worktreeId);
}

/** The worktree's entries by `testFileId`; empty when none or unreadable. */
export function readOtherMachineKeys(
  store: Store,
  worktreeId: WorktreeId,
): Map<string, OtherMachineKey> {
  return parseOtherMachineKeys(store.meta.get(otherMachineKeysMetaKey(worktreeId)));
}

/** A row's text as entries by `testFileId`; empty for `null` or what does not parse. */
export function parseOtherMachineKeys(raw: string | null): Map<string, OtherMachineKey> {
  const entries = new Map<string, OtherMachineKey>();
  if (raw === null) return entries;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!Array.isArray(value)) return entries;
  for (const item of value) {
    if (!isEntry(item)) continue;
    const [project, path, runId, currentKey, storedKey] = item;
    const testFile: TestFileRef = {
      project: project as ProjectName,
      path: path as RelativePath,
    };
    entries.set(testFileId(testFile), {
      testFile,
      runId,
      currentKey: currentKey as CheckKey,
      storedKey: storedKey as CheckKey,
    });
  }
  return entries;
}

/**
 * Writes `admitted` over the stored entries, inside the caller's
 * transaction: a file's newer entry replaces its older one, and a file in
 * `cleared` loses its entry (its run on another machine stored nothing).
 * An entry stays only while `currentKeyOf` gives its `currentKey`, the
 * worktree's live key for the file, so the row holds at most one entry per
 * test file the worktree has.
 */
export function recordOtherMachineKeys(
  store: Store,
  worktreeId: WorktreeId,
  admitted: readonly OtherMachineKey[],
  cleared: readonly TestFileRef[],
  currentKeyOf: (testFile: TestFileRef) => CheckKey | null | undefined,
): void {
  const entries = readOtherMachineKeys(store, worktreeId);
  for (const testFile of cleared) entries.delete(testFileId(testFile));
  for (const entry of admitted) entries.set(testFileId(entry.testFile), entry);
  const kept: Entry[] = [];
  for (const e of entries.values()) {
    if (currentKeyOf(e.testFile) !== e.currentKey) continue;
    kept.push([e.testFile.project, e.testFile.path, e.runId, e.currentKey, e.storedKey]);
  }
  const key = otherMachineKeysMetaKey(worktreeId);
  if (kept.length === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify(kept));
}

function isEntry(value: unknown): value is Entry {
  return Array.isArray(value) && value.length === 5 && value.every((v) => typeof v === "string");
}
