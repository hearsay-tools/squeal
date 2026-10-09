import { testFileId } from "../keys/index.js";
import type { CheckKey, Store, TestFileRef, WorktreeId } from "../types/index.js";

/*
 * Review wave 13i, B1 (task 001-187): a heal (`storeResults`) refreshes
 * another worktree's states from a run that replaced a fail with a pass. When
 * that run also failed a check the receiving worktree never confirmed, the
 * receiving file is held there (spec 001 D6, `heldFailure`): its states lose
 * their result, and its daemon's ledger, which applied the key before, would
 * still count the file as done. The heal leaves this signal in `meta` with
 * the file's row marked `queued`; the receiving daemon takes it under its
 * lock (`Ledger.confirmHeld`) and queues the file for a local run.
 */

/** One held file of a worktree and the key it is held at. */
export interface HeldFile {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
}

/** `meta` key of the files a heal left held in `worktreeId`, a JSON array of `HeldFile`. */
export function heldFilesMetaKey(worktreeId: WorktreeId): string {
  return `held-files:${worktreeId}`;
}

/** Adds `file` to the worktree's held files; call inside the transaction of the heal. */
export function addHeldFile(store: Store, worktreeId: WorktreeId, file: HeldFile): void {
  const held = readHeldFiles(store, worktreeId).filter(
    (h) => testFileId(h.testFile) !== testFileId(file.testFile),
  );
  store.meta.set(heldFilesMetaKey(worktreeId), JSON.stringify([...held, file]));
}

/** Reads and clears the worktree's held files, in one transaction. */
export function takeHeldFiles(store: Store, worktreeId: WorktreeId): HeldFile[] {
  return store.transaction(() => {
    const held = readHeldFiles(store, worktreeId);
    if (held.length > 0) store.meta.set(heldFilesMetaKey(worktreeId), "[]");
    return held;
  });
}

function readHeldFiles(store: Store, worktreeId: WorktreeId): HeldFile[] {
  const raw = store.meta.get(heldFilesMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(isHeldFile) : [];
  } catch {
    return [];
  }
}

function isHeldFile(value: unknown): value is HeldFile {
  if (typeof value !== "object" || value === null) return false;
  const { testFile, key } = value as Record<string, unknown>;
  if (typeof key !== "string" || typeof testFile !== "object" || testFile === null) return false;
  const { project, path } = testFile as Record<string, unknown>;
  return typeof project === "string" && typeof path === "string";
}
