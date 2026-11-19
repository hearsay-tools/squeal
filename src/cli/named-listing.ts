import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { lastScannedBy } from "../core/daemon/bootstrapped.js";
import { readInstallWait } from "../core/scheduler/install-wait.js";
import { covers, readRefined } from "../core/scheduler/refined.js";
import type { AbsolutePath, EpochMs, RevisionNumber, WorktreeId } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";
import type { DaemonRecord, TestFileKeyRecord } from "../core/types/store-records.js";
import type { NamedSelection, UnmatchedPath } from "./named-selection.js";

/*
 * Row 023-26 (spec 023 lessons, round 3, Q7): while the daemon is starting,
 * or has not listed the test files of the latest revision, a named path that
 * selects nothing says nothing of its closure or of the listed files: the
 * listing it would be read against does not exist yet. The named wait goes
 * on until the listing or its deadline, and its text says only that Squeal
 * is still starting, the time so far and the next step.
 */

/** The listing a named selection's unmatched paths wait for (`NamedSelection.unlisted`). */
export interface SelectionUnlisted {
  /**
   * `null`: the daemon has not listed this worktree's test files yet, as
   * `StatusHeader.testFilesListed` reads it; else the revision whose test
   * files it has not listed yet (`runnerPartPending`).
   */
  readonly revision: RevisionNumber | null;
  /**
   * Review wave-16 B2: with the listing done, the named paths that changed on
   * disk after the newest listed revision (`newToListing`), which no listing
   * holds yet; `revision` is then that listed revision. Absent: the whole
   * listing is not done.
   */
  readonly paths?: readonly string[];
  /**
   * Set by a named wait that returned while a daemon held the worktree: the
   * time so far, since the daemon started (`revision` `null`) or since the
   * revision was recorded, in ms.
   */
  readonly forMs?: number;
}

/**
 * The listing this worktree has not finished, from `rows`, its listed test
 * files: none listed and no full pass completed (or an install awaited), as
 * the header's `testFilesListed` reads it; else the latest revision when its
 * runner part is not applied. `null`: the listing is done.
 */
export function listingOf(
  store: Store,
  worktreeId: WorktreeId,
  rows: readonly TestFileKeyRecord[],
): SelectionUnlisted | null {
  if (rows.length === 0) {
    const awaiting = readInstallWait(store, worktreeId) !== null;
    if (awaiting || store.checkpoints.lastCompletedFull(worktreeId) === null) {
      return { revision: null };
    }
  }
  const latest = store.revisions.latest(worktreeId)?.number ?? 0;
  return covers(readRefined(store, worktreeId), latest) ? null : { revision: latest };
}

/**
 * Review wave-16 B2: of `rels`, paths that select nothing in a done listing,
 * those whose file changed (its ctime) after the newest listed revision was
 * recorded and after the daemon that listed it finished its start scan, as
 * `retry`'s new-file check reads it (row 011-134): a new test file the
 * watcher has not recorded yet. With neither time known, none.
 */
export function newToListing(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  rels: readonly string[],
): string[] {
  if (rels.length === 0) return [];
  const latest = store.revisions.latest(worktreeId);
  const times = [latest?.createdAt, lastScannedBy(store, worktreeId) ?? undefined].filter(
    (t): t is number => t !== undefined && Number.isFinite(t),
  );
  if (times.length === 0) return [];
  const listedAt = Math.max(...times);
  return rels.filter((rel) => {
    const stat = statSync(join(root, rel), { throwIfNoEntry: false });
    return stat?.isFile() === true && stat.ctimeMs > listedAt;
  });
}

/** Review wave-16 B2: the unmatched files new to a done listing, as `unlisted`; `null` with none. */
export function newPaths(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  unmatched: readonly UnmatchedPath[],
): SelectionUnlisted | null {
  const inside = (p: UnmatchedPath) => !isAbsolute(p.resolved) && !p.resolved.startsWith("..");
  const files = unmatched.filter((p) => p.folder !== true && inside(p)).map((p) => p.resolved);
  const paths = newToListing(store, worktreeId, root, files);
  if (paths.length === 0) return null;
  return { revision: store.revisions.latest(worktreeId)?.number ?? 0, paths };
}

/** What a named wait that returned with a daemon reads its time so far from (`withUnlisted`). */
export interface UnlistedClock {
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly record: DaemonRecord | null;
  readonly now: EpochMs;
  /** The wait's own time so far, in ms. */
  readonly elapsed: () => number;
}

/**
 * `selection` as a named wait returns it while a listing that is not done
 * holds it: its list partial (row 011-401) and, with `clock`, the time so
 * far, since `record`'s daemon started or the revision was recorded, at
 * least the wait's own. Without `clock`, no daemon held the worktree.
 */
export function withUnlisted(selection: NamedSelection, clock?: UnlistedClock): NamedSelection {
  const { unlisted } = selection;
  if (unlisted === undefined) return selection;
  // A new path waits for a revision not recorded yet.
  const partial = selection.partial ?? {
    revision: unlisted.paths === undefined ? unlisted.revision : null,
  };
  if (clock === undefined) return { ...selection, partial };
  const { store, worktreeId, record, now } = clock;
  const since =
    unlisted.paths !== undefined
      ? undefined
      : unlisted.revision === null
        ? record?.startedAt
        : store.revisions.get(worktreeId, unlisted.revision)?.createdAt;
  const waited = clock.elapsed();
  const forMs = since === undefined ? waited : Math.max(waited, now - since);
  return { ...selection, partial, unlisted: { ...unlisted, forMs } };
}

/**
 * `Squeal is still starting here (62 s); wait again with the same command`,
 * or for a revision `Squeal has not listed revision 5 here yet (3 s); …`.
 * Without the time, a snapshot's or a wait's that found no daemon, only what
 * is not listed: no daemon may be starting.
 */
export function unlistedText({ revision, paths, forMs }: SelectionUnlisted): string {
  const what =
    paths !== undefined
      ? `Squeal has not listed ${paths.join(", ")} here yet`
      : revision === null
        ? forMs === undefined
          ? "Squeal has not listed the test files here yet"
          : "Squeal is still starting here"
        : `Squeal has not listed revision ${revision} here yet`;
  if (forMs === undefined) return what;
  return `${what} (${Math.round(forMs / 1_000)} s); wait again with the same command`;
}
