import { isRecord } from "../fs/json.js";
import type { WorktreeId } from "../types/common.js";
import type { SquealBuild, SquealMismatch } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Spec 018 D21 (row 018-34): the export the shared reader last refused
 * because CI ran a Squeal with another key format, kept for status as a fact
 * of the worktree, not as a note: one record, replaced by a later refusal and
 * cleared by the next import, so status says it once and stops when it no
 * longer holds.
 */

/** `meta` key of the worktree's refused export. */
export function sharedRefusedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("sharedRefused", worktreeId);
}

/** Records `mismatch`, or with `null` clears the record. */
export function writeSquealMismatch(
  store: Store,
  worktreeId: WorktreeId,
  mismatch: SquealMismatch | null,
): void {
  const key = sharedRefusedMetaKey(worktreeId);
  if (mismatch === null) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify(mismatch));
}

/** The record, or `null` when there is none or it cannot be read. */
export function readSquealMismatch(store: Store, worktreeId: WorktreeId): SquealMismatch | null {
  const raw = store.meta.get(sharedRefusedMetaKey(worktreeId));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { ci, here, commit, at } = value;
  const ciBuild = buildOf(ci);
  const hereBuild = buildOf(here);
  if (ciBuild === null || hereBuild === null) return null;
  if (typeof commit !== "string" || typeof at !== "number") return null;
  return { ci: ciBuild, here: hereBuild, commit, at };
}

function buildOf(value: unknown): SquealBuild | null {
  if (!isRecord(value)) return null;
  const { version, keyFormat } = value;
  return typeof version === "string" && typeof keyFormat === "number"
    ? { version, keyFormat }
    : null;
}
