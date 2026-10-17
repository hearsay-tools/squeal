import { revisionText } from "../state/index.js";
import type {
  AbsolutePath,
  CommitSha,
  DaemonLiveness,
  Revision,
  RevisionCommit,
  StatusSnapshot,
} from "../types/index.js";
import { readGitHead } from "./git-head.js";

/** The Git identity fields of a status snapshot. */
export type StatusIdentity = Pick<
  StatusSnapshot,
  "head" | "dirty" | "dirtyObservedAt" | "headMovedSince"
>;

/**
 * Task 011-05 (gh-9): status shows one Git identity. `HEAD` and the dirty
 * flag are the header's (`readRevisionCommit`, a reconciliation pass's
 * `HEAD` move included), so the Worktree line and the revision line agree.
 * A `HEAD` in the git dir other than the recorded one is a commit or a
 * checkout no pass has seen yet (spec 001 D2): status names that `HEAD`, says
 * it moved since the latest revision, and calls the dirty flag not known, as
 * it does while no daemon validates (D7). `HEAD` is read from the git dir
 * while no revision is recorded.
 */
export function statusIdentity(
  root: AbsolutePath,
  latest: Revision | null,
  commit: RevisionCommit | undefined,
  daemon: DaemonLiveness,
): StatusIdentity {
  const live = readGitHead(root);
  if (latest === null) return { head: live, dirty: null, dirtyObservedAt: null };
  const recorded = commit?.head ?? latest.head;
  if (live !== null && live !== recorded) {
    return { head: live, dirty: null, dirtyObservedAt: null, headMovedSince: latest.number };
  }
  // Nothing observes the files without a daemon, so the last flag may be old news (D7).
  if (daemon.state !== "alive") return { head: recorded, dirty: null, dirtyObservedAt: null };
  return { head: recorded, dirty: commit?.dirty ?? latest.dirty, dirtyObservedAt: latest.number };
}

/**
 * The status revision line's value: the revision beside the snapshot's
 * `HEAD` (`1 · f512f5c3 + 0`), `+ 0` once `HEAD` moved after the revision,
 * with `, dirty not known` while the snapshot's dirty flag is.
 */
export function statusRevisionText(s: StatusSnapshot): string {
  const moved = s.headMovedSince !== undefined;
  if (s.commit === undefined && !moved) return revisionText(s.revision, undefined);
  const sinceHead = moved ? 0 : (s.commit?.sinceHead ?? 0);
  const text = revisionText(s.revision, { head: s.head, sinceHead, dirty: s.dirty === true });
  return s.dirty === null && s.head !== null ? `${text}, dirty not known` : text;
}

/** Spec 001 D7 as amended: the dirty flag is labelled with its revision, not known without a daemon. */
export function worktreeLine(s: StatusSnapshot): string {
  return `Worktree: ${s.worktreeRoot} (HEAD ${shortCommit(s.head)}, ${dirtyText(s)})`;
}

function dirtyText(s: StatusSnapshot): string {
  if (s.dirty !== null) {
    return `${s.dirty ? "dirty" : "clean"} at revision ${s.dirtyObservedAt ?? s.revision}`;
  }
  const alive = s.daemon.state === "alive";
  if (s.headMovedSince !== undefined) {
    const reason = alive ? " until the next pass" : ": no daemon is validating";
    return `moved since revision ${s.headMovedSince}; dirty state not known${reason}`;
  }
  return alive
    ? "dirty state not known: no revision recorded yet"
    : "dirty state not known: no daemon is validating";
}

export function shortCommit(commit: CommitSha): string {
  return commit === null ? "no commit" : commit.slice(0, 7);
}
