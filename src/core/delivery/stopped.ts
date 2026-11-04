import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord, lstatOrNull, runGit, splitNul } from "../fs/index.js";
import { gitHead } from "../status/git-head.js";
import {
  type AbsolutePath,
  type EpochMs,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9): `squeal stop` leaves a stopped
 * mark for its worktree, `{ at, tree }`, and no hook boundary ensures a
 * daemon while it holds. With no daemon there is no revision, so the mark
 * keeps a print of the tree as git sees it (`treePrint`) and a boundary that
 * finds another print clears it: the agent edited. A heartbeat after `at`
 * voids it too, so a daemon `squeal start` or anything else started ends it,
 * as a rest ends (`restState`). Edits to gitignored files leave the print as
 * it was, so they do not clear the mark.
 *
 * Row 011-254 (gh-104, the human 2026-10-26: "Approve, whole worktree"):
 * `squeal stop --until-start` marks `untilStart`. No tree print and no
 * heartbeat clears that mark; only `squeal start` does, and a plain stop
 * keeps it.
 */

/** How long a boundary's tree print may take git; past it the stop is honoured. */
export const TREE_PRINT_TIMEOUT_MS = 1_000;

/** `squeal stop` at `at`, the tree printed as `tree` (`treePrint`), `null` when git could not tell. */
export interface StopMark {
  readonly at: EpochMs;
  readonly tree: string | null;
  /** Row 011-254: `squeal stop --until-start`; no edit, Git operation or heartbeat ends it. */
  readonly untilStart?: true;
}

/** `meta` key of the worktree's stopped mark. */
export function stoppedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonStopped", worktreeId);
}

/**
 * The worktree's stopped mark as stored, `null` with none or one unreadable:
 * daemon presence reads it (`presence/facts.ts`), and the writes below read
 * it again inside their transaction.
 */
export function readStop(store: Store, worktreeId: WorktreeId): StopMark | null {
  const text = store.meta.get(stoppedMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark: unknown = JSON.parse(text);
    if (!isRecord(mark) || typeof mark.at !== "number") return null;
    return {
      at: mark.at as EpochMs,
      tree: typeof mark.tree === "string" ? mark.tree : null,
      ...(mark.untilStart === true ? { untilStart: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * `squeal stop` at `at` for the worktree, its tree printed as `tree`, with
 * `--until-start` when `untilStart`. A plain stop keeps an `untilStart` mark
 * (row 011-254, the coordinator 2026-10-26). Whether the mark it leaves is
 * `untilStart`. Call inside a transaction.
 */
export function markStopped(
  store: Store,
  worktreeId: WorktreeId,
  at: EpochMs,
  tree: string | null,
  untilStart = false,
): boolean {
  const until = untilStart || readStop(store, worktreeId)?.untilStart === true;
  const mark: StopMark = { at, tree, ...(until ? { untilStart: true } : {}) };
  store.meta.set(stoppedMetaKey(worktreeId), JSON.stringify(mark));
  return until;
}

/** Forgets the worktree's stopped mark: an edit, or `squeal start`. */
export function clearStopped(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(stoppedMetaKey(worktreeId));
}

/**
 * Whether a boundary must leave the worktree without a daemon: an
 * `untilStart` mark holds, with no print of the tree; another mark holds and
 * the tree prints as it did at the stop, or git could not print it. A
 * tree that prints otherwise clears the mark. A mark whose stop could not
 * print the tree takes the first print a boundary gets as its own and holds,
 * so git coming back is not an edit (review wave-1.10 B2); an edit before
 * that print is missed. `mark` is the stop that holds by the store alone
 * (`Presence.stop`), `null` with none.
 */
export async function stopHolds(
  store: Store,
  at: { readonly id: WorktreeId; readonly root: AbsolutePath },
  mark: StopMark | null,
): Promise<boolean> {
  if (mark === null) return false;
  if (mark.untilStart === true) return true;
  const tree = await treePrint(at.root, TREE_PRINT_TIMEOUT_MS);
  if (tree === null || tree === mark.tree) return true;
  // Re-read after git answered: a `squeal start` that cleared the mark, or a
  // new stop that replaced it, meanwhile wins (review wave-1.10 R2).
  return store.transaction(() => {
    const now = readStop(store, at.id);
    if (now === null) return false;
    if (now.at !== mark.at || now.tree !== mark.tree || now.untilStart === true) return true;
    if (mark.tree === null) {
      markStopped(store, at.id, mark.at, tree);
      return true;
    }
    clearStopped(store, at.id);
    return false;
  });
}

/**
 * A hash of what git sees of the worktree at `root`: `HEAD`, its status with
 * every untracked file, and the size, mtime and inode of each path the
 * status lists, so a second edit of a file already modified prints anew.
 * `null` when git fails or takes longer than `timeoutMs`.
 */
export async function treePrint(root: AbsolutePath, timeoutMs?: number): Promise<string | null> {
  const options = timeoutMs === undefined ? {} : { timeoutMs };
  try {
    const [head, status] = await Promise.all([
      gitHead(root, options),
      runGit(
        root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"],
        options,
      ),
    ]);
    const hash = createHash("sha1")
      .update(head ?? "")
      .update("\0")
      .update(status);
    for (const path of listedPaths(status)) {
      const stat = lstatOrNull(join(root, path));
      hash.update(stat === null ? "-\0" : `${stat.size} ${stat.mtimeMs} ${stat.ino}\0`);
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/** The paths of `git status --porcelain=v1 -z`; a rename's source field is skipped. */
function listedPaths(status: string): string[] {
  const fields = splitNul(status);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    paths.push(field.slice(3));
    if (field[0] === "R" || field[0] === "C") i++;
  }
  return paths;
}
