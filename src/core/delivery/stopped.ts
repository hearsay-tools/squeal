import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord, lstatOrNull, runGit, splitNul } from "../fs/index.js";
import type {
  AbsolutePath,
  DaemonLiveness,
  EpochMs,
  Store,
  WorktreeId,
  WorktreeRecord,
} from "../types/index.js";
import { worktreeMetaKey } from "../types/index.js";

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9): `squeal stop` leaves a stopped
 * mark for its worktree, `{ at, tree }`, and no hook boundary ensures a
 * daemon while it holds. With no daemon there is no revision, so the mark
 * keeps a print of the tree as git sees it (`treePrint`) and a boundary that
 * finds another print clears it: the agent edited. A heartbeat after `at`
 * voids it too, so a daemon `squeal start` or anything else started ends it,
 * as a rest ends (`restState`). Edits to gitignored files leave the print as
 * it was, so they do not clear the mark.
 */

/** How long a boundary's tree print may take git; past it the stop is honoured. */
export const TREE_PRINT_TIMEOUT_MS = 1_000;

interface StoppedMark {
  readonly at: EpochMs;
  /** `treePrint` when the stop was asked; `null` when git could not tell. */
  readonly tree: string | null;
}

/** `meta` key of the worktree's stopped mark. */
export function stoppedMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("daemonStopped", worktreeId);
}

/** `squeal stop` at `at` for the worktree, its tree printed as `tree`. */
export function markStopped(
  store: Store,
  worktreeId: WorktreeId,
  at: EpochMs,
  tree: string | null,
): void {
  store.meta.set(stoppedMetaKey(worktreeId), JSON.stringify({ at, tree } satisfies StoppedMark));
}

/** Forgets the worktree's stopped mark: an edit, or `squeal start`. */
export function clearStopped(store: Store, worktreeId: WorktreeId): void {
  store.meta.delete(stoppedMetaKey(worktreeId));
}

/**
 * The worktree's stopped mark while it holds by the store alone: set, no
 * daemon heartbeat since, and no daemon recorded alive. The tree is not
 * compared here; `stopHolds` does that at a boundary. A worktree with no row
 * yet (a linked worktree beside a shared store) keeps its mark too: the mark
 * is keyed by the worktree's id, never by its row (review wave-1.10 B1).
 */
export function heldStop(
  store: Store,
  worktreeId: WorktreeId,
  worktree: WorktreeRecord | null | undefined,
  live: DaemonLiveness,
): StoppedMark | null {
  if (live.state === "alive") return null;
  const mark = readMark(store, worktreeId);
  if (mark === null) return null;
  const heartbeat = worktree?.daemon?.heartbeatAt ?? worktree?.lastHeartbeatAt;
  return heartbeat !== undefined && heartbeat > mark.at ? null : mark;
}

/**
 * `live` with `stopped` set while the worktree's stopped mark holds
 * (`heldStop`). Not while a daemon a hook spawned is starting (row 011-20):
 * a mark `squeal stop` left after that hook found none is void at the
 * daemon's first heartbeat, and a start that outlives its grace is no longer
 * starting (`asTold`).
 */
export function asStopped(
  store: Store,
  worktreeId: WorktreeId,
  worktree: WorktreeRecord | null | undefined,
  live: DaemonLiveness,
): DaemonLiveness {
  if (live.state !== "down" || live.startingSince !== undefined) return live;
  if (heldStop(store, worktreeId, worktree, live) === null) return live;
  return { ...live, stopped: true };
}

/**
 * Whether a boundary must leave the worktree without a daemon: the mark holds
 * and the tree prints as it did at the stop, or git could not print it. A
 * tree that prints otherwise clears the mark. A mark whose stop could not
 * print the tree takes the first print a boundary gets as its own and holds,
 * so git coming back is not an edit (review wave-1.10 B2); an edit before
 * that print is missed.
 */
export async function stopHolds(
  store: Store,
  at: { readonly id: WorktreeId; readonly root: AbsolutePath },
  worktree: WorktreeRecord | null | undefined,
  live: DaemonLiveness,
): Promise<boolean> {
  const mark = heldStop(store, at.id, worktree, live);
  if (mark === null) return false;
  const tree = await treePrint(at.root, TREE_PRINT_TIMEOUT_MS);
  if (tree === null || tree === mark.tree) return true;
  // Re-read after git answered: a `squeal start` that cleared the mark, or a
  // new stop that replaced it, meanwhile wins (review wave-1.10 R2).
  return store.transaction(() => {
    const now = readMark(store, at.id);
    if (now === null) return false;
    if (now.at !== mark.at || now.tree !== mark.tree) return true;
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
      runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { ...options, okCodes: [0, 1] }),
      runGit(
        root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"],
        options,
      ),
    ]);
    const hash = createHash("sha1").update(head.trim()).update("\0").update(status);
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

function readMark(store: Store, worktreeId: WorktreeId): StoppedMark | null {
  const text = store.meta.get(stoppedMetaKey(worktreeId));
  if (text === null) return null;
  try {
    const mark: unknown = JSON.parse(text);
    if (!isRecord(mark) || typeof mark.at !== "number") return null;
    return { at: mark.at as EpochMs, tree: typeof mark.tree === "string" ? mark.tree : null };
  } catch {
    return null;
  }
}
