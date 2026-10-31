import type { RelativePath, RevisionNumber, TestFileKeyRecord } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";
import type { InheritedBatch } from "./promotions.js";
import { inheritedBatches } from "./promotions-row.js";
import { isCatchUp } from "./revision.js";

/*
 * Spec 011 C4, "Explicit checkpoints" as amended 2026-10-20 (the human, row
 * 011-30, Q3 (a), task 011-33): "Whatever the policy, a daemon's start
 * queues again every file its worktree's rows leave `queued` or `running`,
 * at this daemon's key, unless the lookup finds a result there. [...] Step
 * 4 orders those files as of the revisions whose re-key moves are still open
 * for them." The rows and the moves are what every release since 001-258
 * writes, so a step-down's or a stop's cancelled tier, a revision recorded
 * and never refined, and a kill all leave them; nothing is asked of the
 * predecessor.
 */

/** The work a predecessor queued and did not finish, by `testFileId`, in step 4's groups. */
export interface Handover {
  /** Every file a row left `queued` or `running`. */
  readonly pending: ReadonlySet<string>;
  /** Reached by an open move's revision of fewer than 10 keyed paths: work an edit caused. */
  readonly first: ReadonlySet<string>;
  /** Reached only by catch-up revisions (`isCatchUp`). */
  readonly catchUp: ReadonlySet<string>;
  /** The paths of the revisions that reached a `first` file, for its class within the group. */
  readonly changed: ReadonlySet<RelativePath>;
}

/**
 * Reads the handover from `previous`, the worktree's rows as its last
 * daemon left them, and `open`, the re-key moves open in the store
 * (`openMoves`) as read before the ledger's first commit, which a start
 * under `lookup-only` makes before its recheck (row 011-227). Call once the
 * ledger holds the listed files and their closures. A file with no open
 * move recorded is taken as open at its row's revision, as a ledger's first
 * commit takes it in (`recordMoves`). Each revision is classified on its
 * own, a small one's reach winning over a large one's (review wave 5, B3);
 * a file no revision reached, as an environment's re-key, stays in the
 * second group.
 */
export function handover(
  context: SchedulerContext,
  ledger: Ledger,
  previous: ReadonlyMap<string, TestFileKeyRecord>,
  open: ReadonlyMap<string, readonly [RevisionNumber, RevisionNumber]>,
): Handover {
  const { store, worktreeId } = context;
  const ranges = new Map<string, readonly [RevisionNumber, RevisionNumber]>();
  for (const [id, row] of previous) {
    if (row.pending === null || !ledger.files.has(id)) continue;
    ranges.set(id, open.get(id) ?? [row.revision, row.revision]);
  }
  const first = new Set<string>();
  const catchUp = new Set<string>();
  const changed = new Set<RelativePath>();
  if (ranges.size === 0) return { pending: new Set(), first, catchUp, changed };
  const from = Math.min(...[...ranges.values()].map(([earliest]) => earliest));
  const to = Math.max(...[...ranges.values()].map(([, latest]) => latest));
  for (const revision of store.revisions.range(worktreeId, from - 1, to)) {
    const paths = new Set(revision.changes.map((change) => change.path));
    const large = isCatchUp(context, ledger, paths);
    let reachedFirst = false;
    for (const id of ledger.recentOf(paths)) {
      const range = ranges.get(id);
      if (range === undefined || revision.number < range[0] || revision.number > range[1]) {
        continue;
      }
      if (large) {
        catchUp.add(id);
      } else {
        first.add(id);
        reachedFirst = true;
      }
    }
    if (reachedFirst) for (const path of paths) changed.add(path);
  }
  for (const id of first) catchUp.delete(id);
  return { pending: new Set(ranges.keys()), first, catchUp, changed };
}

/**
 * Row 011-283 (C15 Lifetime, `research/named-wait-rule.md` rule 3): the
 * batches of the store's promotions row, in their order, each with the
 * files of it this start queued again at the key `previous`, the rows its
 * predecessor left, holds for it; a file whose key moved is no longer its
 * batch's. For `RunQueue.takeOver`, once the baseline queued its files.
 */
export function inheritedOf(
  context: SchedulerContext,
  ledger: Ledger,
  previous: ReadonlyMap<string, TestFileKeyRecord>,
): InheritedBatch[] {
  return inheritedBatches(context.store, context.worktreeId).map(({ files, until }) => ({
    until,
    refs: files.flatMap((id) => {
      const file = ledger.files.get(id);
      if (file === undefined || file.key === null || previous.get(id)?.key !== file.key) return [];
      return ledger.queue.has(file.ref) ? [file.ref] : [];
    }),
  }));
}
