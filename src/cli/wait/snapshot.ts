import { setTimeout as sleep } from "node:timers/promises";
import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { testFileId } from "../../core/keys/reverse-index.js";
import { daemonLiveness } from "../../core/presence/heartbeat.js";
import {
  STATUS_BUSY_TIMEOUT_MS,
  type StatusContext,
  withStatusStore,
} from "../../core/status/open.js";
import { buildSnapshot } from "../../core/status/snapshot.js";
import { pauseOnlyIds, readNamedFiles } from "../../core/status/standing.js";
import type { AbsolutePath, EpochMs } from "../../core/types/common.js";
import type { StatusUnavailable } from "../../core/types/status.js";
import { selectNamedFiles, sourcePaths } from "../named-selection.js";
import {
  type DaemonSync,
  pollPause,
  SYNC_POLL_MS,
  syncDaemon,
  syncedReaders,
} from "../status-sync.js";
import { CheckUsageError, checkUsage, snapshotFocus } from "../status-wait-focus.js";
import { leftGroupsOf } from "../status-wait-groups.js";
import { holdOfWait, readClasses, readVerdict } from "../verdict.js";
import { decideStatusWait } from "./decide.js";
import { decidedOutcome, ownNamedFiles } from "./named.js";
import type { NamedSnapshotOptions, NamedWait, NamedWaitEnded } from "./named-types.js";
import { SETTLE_MS, STATUS_WAITS, type StatusRecord } from "./status-table.js";
import { fallbackOf, selectionReady } from "./synced.js";

/*
 * Row 011-331: the snapshot (`status <path>` without `--wait`), moved from
 * `status-paths.ts` as it was: its sync, then its one read, which its row
 * of `STATUS_WAITS` decides.
 */

const ROW = STATUS_WAITS.snapshot;

/**
 * `squeal status <path>...` without `--wait` (row 011-28, 005 D2 as amended
 * 2026-10-20, gh-42): the named wait's answer from one read, worded as a
 * snapshot. It asks the daemon's sync once and reads when its pass is
 * stored, or after `settleMs`, whichever comes first, so an edit the daemon
 * has not stored yet never leaves an older result current: that read has no
 * verdict and says so. A daemon that cannot sync is read at `settleMs` and
 * gives no verdict either, and one that is not validating gives none, as
 * status says of it. It promotes nothing (C15).
 */
export async function namedSnapshot(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedSnapshotOptions,
): Promise<NamedWait> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const pollMs = options.pollMs ?? SYNC_POLL_MS;
  let sync: DaemonSync | undefined;
  // The row's store rule: every read of the snapshot is its first or its last.
  const unread = (result: StatusUnavailable): NamedWait => {
    const step = decideStatusWait(ROW, { store: "unread" });
    if (step.kind !== "end")
      throw new Error("snapshot: a read that did not read the store ends it");
    return { outcome: "unavailable", waitedMs: elapsed(), result };
  };
  try {
    const found = withStatusStore(cwd, { busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS }, (context) => {
      const sources = sourcePaths(
        context.store,
        worktreeIdFor(context.root),
        context.root,
        cwd,
        paths,
      );
      // Row 011-49: its sync's requests end by the read, and the process with them.
      sync =
        options.sync === undefined
          ? syncDaemon(context.root, pollMs, sources, started + settleMs)
          : options.sync(context.root, pollMs, sources);
      return { root: context.root };
    });
    if ("available" in found) return unread(found);
    for (;;) {
      const state = sync?.current().state;
      const left = settleMs - elapsed();
      if (state === "synced" || left <= 0) break;
      await (state === "unsupported" ? sleep(left) : pollPause(Math.min(pollMs, left), sync));
    }
    const read = withStatusStore(cwd, { busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS }, (context) =>
      readOnce(context, cwd, paths, sync, options.now(), options.checks ?? []),
    );
    if ("usage" in read) throw new CheckUsageError(read.usage);
    if ("available" in read) return unread(read);
    return { ...read, waitedMs: elapsed() };
  } finally {
    sync?.stop();
  }
}

/** The snapshot's one read: the named wait's last read, but liveness as status reads it. */
function readOnce(
  { store, root }: StatusContext,
  cwd: AbsolutePath,
  paths: readonly string[],
  sync: DaemonSync | undefined,
  now: EpochMs,
  checks: readonly string[],
): NamedWaitEnded | { readonly usage: string } {
  const id = worktreeIdFor(root);
  const current = sync?.current() ?? { state: "unsupported" as const };
  // Row 011-234: a synced daemon's readers of the source paths, else the stored closures.
  const selection = selectNamedFiles(store, id, root, cwd, paths, syncedReaders(current));
  const all = readClasses(store, id, selection.files);
  const record = store.worktrees.get(id)?.daemon ?? null;
  // The row's `daemon` cell: the raw heartbeat, alive or not.
  const liveness = daemonLiveness(record, now);
  // Only a daemon that answered its sync says the store holds the latest
  // edits: one that could not (paused, its socket gone, its pass failed)
  // gives no verdict, though its heartbeat is fresh (review of
  // cand/0.1.233, B1). A wait falls back to its settle time instead.
  const ready = liveness.state === "alive" && selectionReady(current, all, fallbackOf(ROW, true));
  const own = ownNamedFiles(root, cwd, paths, selection);
  // Row 011-146 (C15): a source path selects no focus (review 0.1.286 B4).
  const usage = checkUsage(checks, ready, own);
  if (usage !== null) return usage;
  const paused = new Set(
    ready ? pauseOnlyIds(store, id, root, selection.files, liveness, now) : [],
  );
  const leftForPause = selection.files.filter((f) => paused.has(testFileId(f)));
  const held = selection.files.filter((f) => !paused.has(testFileId(f)));
  const classes = paused.size === 0 ? all : readClasses(store, id, held);
  const decided = ready ? decidedOutcome(selection, held, classes) : null;
  const read: StatusRecord = {
    store: "read",
    daemon: liveness.state === "alive" ? "alive" : "down",
    decided,
  };
  let hold: ReturnType<typeof holdOfWait> = null;
  let step = decideStatusWait(ROW, read);
  if (step.kind === "read") {
    // Row 011-73 (C6 as amended 2026-10-21): a held file queued on hold has the hold as its verdict.
    hold =
      ready && decided === null
        ? holdOfWait(store, id, () => store.testFileKeys.list(id, held), now)
        : null;
    step = decideStatusWait(ROW, { ...read, hold });
  }
  if (step.kind !== "end") throw new Error("snapshot: its one read ends it");
  const result = buildSnapshot(store, root, now);
  // Row 011-146 (C6 as amended 2026-10-23): the selected checks' focused answers; it requests nothing.
  const focus = snapshotFocus(store, id, root, own, checks);
  return {
    outcome: step.outcome as NamedWaitEnded["outcome"],
    ...(hold === null ? {} : { hold }),
    ...(focus === undefined ? {} : { focus }),
    selection,
    leftForPause,
    ...leftGroupsOf(root, leftForPause),
    verdict: readVerdict(store, id, held),
    files: readNamedFiles(store, id, root, selection.files, result.daemon, now),
    result,
    sync: current,
    snapshot: true,
  };
}
