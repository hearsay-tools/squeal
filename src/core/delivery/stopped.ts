import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { runGit, splitNul } from "../fs/git.js";
import { lstatOrNull, resolveCommonDir } from "../fs/git-layout.js";
import { clearStopped, markStopped } from "../presence/events.js";
import { removeStopFile, withStopFileLock, writeStopFile } from "../presence/lock-events.js";
import { readStopFile } from "../presence/marks.js";
import { readStop, type StopMark, stopLockFile, stoppedMetaKey } from "../presence/stored.js";
import { gitHead } from "../status/git-head.js";
import { lockFileFor } from "../store/paths.js";
import type { AbsolutePath, WorktreeId } from "../types/common.js";
import type { Store } from "../types/store.js";

/*
 * Task 011-08 (gh-22, spec 011 C8 and C9): `squeal stop` leaves a stopped
 * mark for its worktree, `{ at, tree }`, and no hook boundary ensures a
 * daemon while it holds. With no daemon there is no revision, so the mark
 * keeps a print of the tree as git sees it (`treePrint`) and a boundary that
 * finds another print clears it: the agent edited. A heartbeat after `at`
 * voids it too, so a daemon `squeal start` or anything else started ends it,
 * as a rest ends (`Presence.rest`). Edits to gitignored files leave the print as
 * it was, so they do not clear the mark.
 *
 * Row 011-254 (gh-104, the human 2026-10-26: "Approve, whole worktree"):
 * `squeal stop --until-start` marks `untilStart`. No tree print and no
 * heartbeat clears that mark; only `squeal start` does, and a plain stop
 * keeps it.
 */

/** How long a boundary's tree print may take git; past it the stop is honoured. */
export const TREE_PRINT_TIMEOUT_MS = 1_000;

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
  write: <T>(work: () => T) => Promise<T> = async (work) => work(),
): Promise<boolean> {
  if (mark === null) return false;
  if (mark.untilStart === true) return true;
  const tree = await treePrint(at.root, TREE_PRINT_TIMEOUT_MS);
  if (tree === null || tree === mark.tree) return true;
  // Row 021-39 (#285): a mark in the file beside the lock file changes there, with no store write.
  const lockFile = markLockFile(store, at);
  if (lockFile !== null && existsSync(dirname(lockFile))) {
    let outcome: FileOutcome;
    try {
      // Review 0.1.639 B1: read, compared and changed under the mark's lock, with no await.
      outcome = withStopFileLock(lockFile, () => fileOutcome(lockFile, mark, tree));
    } catch {
      return true;
    }
    if (outcome === "holds") return true;
    if (outcome === "cleared") {
      if (store.meta.get(stoppedMetaKey(at.id)) !== null)
        await write(() => store.transaction(() => clearStopped(store, at.id)));
      return false;
    }
  }
  // `squeal start` removed the file meanwhile and left no legacy mark.
  if (store.meta.get(stoppedMetaKey(at.id)) === null) return false;
  // Re-read after git answered: a `squeal start` that cleared the mark, or a
  // new stop that replaced it, meanwhile wins (review wave-1.10 R2).
  // Spec 021 D15: with a daemon serving, under the worktree's write lease (`HookContext.write`).
  return write(() =>
    store.transaction(() => {
      const now = readStop(store, at.id);
      if (now === null) return false;
      if (now.at !== mark.at || now.tree !== mark.tree || now.untilStart === true) return true;
      if (mark.tree === null) {
        markStopped(store, at.id, mark.at, tree);
        return true;
      }
      clearStopped(store, at.id);
      return false;
    }),
  );
}

/** What `fileOutcome` did to the mark file: it holds, the edit removed it, or there is none. */
type FileOutcome = "holds" | "cleared" | "none";

/**
 * `stopHolds` over the mark in the file beside `lockFile`, as it reads now,
 * after git printed `tree`; call under its lock. A new stop or an
 * `untilStart` one holds (review wave-1.10 R2); a mark with no print takes
 * `tree`; else the edit removes the file. `none` with no file: a `squeal
 * start` removed it, or the mark is a legacy one.
 */
function fileOutcome(lockFile: AbsolutePath, mark: StopMark, tree: string): FileOutcome {
  const now = readStopFile(lockFile);
  if (now === null) return "none";
  if (now.at !== mark.at || now.tree !== mark.tree || now.untilStart === true) return "holds";
  if (mark.tree === null) {
    try {
      writeStopFile(lockFile, { at: mark.at, tree });
    } catch {
      // The mark keeps no print, and the next boundary takes one.
    }
    return "holds";
  }
  try {
    removeStopFile(lockFile);
  } catch {
    // A mark left behind is voided by the heartbeat of the daemon this boundary starts.
  }
  return "cleared";
}

/** The worktree's lock file, by the store's paths, else by the common dir of `at.root`. */
function markLockFile(
  store: Store,
  at: { readonly id: WorktreeId; readonly root: AbsolutePath },
): AbsolutePath | null {
  const byStore = stopLockFile(store, at.id);
  if (byStore !== null) return byStore;
  const commonDir = resolveCommonDir(at.root);
  return commonDir === null ? null : lockFileFor(commonDir, at.id);
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
