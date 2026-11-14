import type { WorktreeId } from "../types/common.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Row 011-339 (`research/progress-records.md`): the stored install wait and
 * its command, their one owner. `install.ts` decides when the wait starts
 * and ends; the scheduler's in-memory flags are its own (card 5).
 *
 * The wait is `"true"` while the daemon of a worktree waits for an install:
 * the root `package.json` declares dependencies and the root has no
 * installed lockfile, so nothing is listed or run (spec 001 D5 as amended,
 * task 001-100, defect 18), or the JSON array of the workspaces still
 * missing theirs while others have one (task 001-107, review wave 11 N2).
 * Any other value, or none, is not waiting. The command that installs the
 * dependencies (`npm ci`, …) is named by the header's install sentence (task
 * 001-410); it is written with the wait and read only while it waits.
 */

function awaitingInstallMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("awaitingInstall", worktreeId);
}

function installCommandMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("installCommand", worktreeId);
}

/** A stored install wait. */
export interface StoredInstallWait {
  /** The workspaces still missing their install; none named when the root's is missing. */
  readonly workspaces: readonly string[];
  /** The command that ends the wait; `null` when a daemon from before task 001-410 waits. */
  readonly command: string | null;
}

/** The install the worktree waits for, with its command; `null` when it waits for none. */
export function readInstallWait(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): StoredInstallWait | null {
  const workspaces = parseWorkspaces(store.meta.get(awaitingInstallMetaKey(worktreeId)));
  if (workspaces === null) return null;
  const command = store.meta.get(installCommandMetaKey(worktreeId));
  return { workspaces, command: command === "" ? null : command };
}

/** The wait starts, or goes on: for `workspaces` (none named: the root's), ended by `command`. */
export function recordInstallWait(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  workspaces: readonly string[],
  command: string,
): void {
  const value = workspaces.length === 0 ? "true" : JSON.stringify(workspaces);
  store.meta.set(awaitingInstallMetaKey(worktreeId), value);
  store.meta.set(installCommandMetaKey(worktreeId), command);
}

/** The wait ended. The command stays, unread. */
export function endInstallWait(store: Pick<Store, "meta">, worktreeId: WorktreeId): void {
  store.meta.set(awaitingInstallMetaKey(worktreeId), "false");
}

/** The workspaces a stored wait names, or `null` when `raw` is not a wait. */
function parseWorkspaces(raw: string | null): readonly string[] | null {
  if (raw === "true") return [];
  if (raw === null || !raw.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : null;
  } catch {
    return null;
  }
}
