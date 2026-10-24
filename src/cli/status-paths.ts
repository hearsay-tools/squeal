import { setTimeout as sleep } from "node:timers/promises";
import { daemonLiveness } from "../core/delivery/index.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { testFileId } from "../core/keys/index.js";
import {
  buildSnapshot,
  STATUS_BUSY_TIMEOUT_MS,
  type StatusContext,
  withStatusStore,
} from "../core/status/index.js";
import type { AbsolutePath, EpochMs } from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { pauseOnlyIds, readNamedFiles } from "./named-files.js";
import { type DaemonSync, pollPause, SYNC_POLL_MS, syncDaemon } from "./status-sync.js";
import { STATUS_WAIT_SETTLE_MS } from "./status-wait.js";
import { CheckUsageError, checkUsage, snapshotFocus } from "./status-wait-focus.js";
import {
  decidedOutcome,
  type NamedPrint,
  type NamedWait,
  type NamedWaitOutcome,
  ownNamedFiles,
  printNamed,
  selectNamedFiles,
} from "./status-wait-paths.js";
import { holdOfWait, readClasses, readVerdict } from "./verdict.js";

export interface NamedSnapshotOptions {
  /** Default `STATUS_WAIT_SETTLE_MS`: the longest the snapshot waits for the daemon's sync. */
  readonly settleMs?: number;
  /** Default `SYNC_POLL_MS`: how often it reads a sync that does not say when it answered. */
  readonly pollMs?: number;
  readonly now: () => EpochMs;
  /** Default `syncDaemon`; tests replace it. */
  readonly sync?: (root: AbsolutePath, pollMs: number) => DaemonSync;
  /** Row 011-146: `--check` texts, whose focused answers it reads and requests nothing for (C6). */
  readonly checks?: readonly string[];
}

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
export async function readNamedSnapshot(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedSnapshotOptions,
): Promise<NamedWait> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const settleMs = options.settleMs ?? STATUS_WAIT_SETTLE_MS;
  const pollMs = options.pollMs ?? SYNC_POLL_MS;
  let sync: DaemonSync | undefined;
  try {
    const found = withStatusStore(cwd, { busyTimeoutMs: STATUS_BUSY_TIMEOUT_MS }, ({ root }) => {
      sync = (options.sync ?? syncDaemon)(root, pollMs);
      return { root };
    });
    if ("available" in found) return { outcome: "unavailable", waitedMs: elapsed(), result: found };
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
    if ("available" in read) return { outcome: "unavailable", waitedMs: elapsed(), result: read };
    return { ...read, waitedMs: elapsed() };
  } finally {
    sync?.stop();
  }
}

/** The snapshot's one read: `waitForNamed`'s last read, but liveness as status reads it. */
function readOnce(
  { store, root }: StatusContext,
  cwd: AbsolutePath,
  paths: readonly string[],
  sync: DaemonSync | undefined,
  now: EpochMs,
  checks: readonly string[],
) {
  const id = worktreeIdFor(root);
  const selection = selectNamedFiles(store, id, root, cwd, paths);
  const all = readClasses(store, id, selection.files);
  const record = store.worktrees.get(id)?.daemon ?? null;
  const liveness = daemonLiveness(record, now);
  const current = sync?.current() ?? { state: "unsupported" as const };
  // Only a daemon that answered its sync says the store holds the latest
  // edits: one that could not (paused, its socket gone, its pass failed)
  // gives no verdict, though its heartbeat is fresh (review of
  // cand/0.1.233, B1). A wait falls back to its settle time instead.
  const ready =
    liveness.state === "alive" &&
    current.state === "synced" &&
    all.revision >= current.revision &&
    !all.unlisted;
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
  // Row 011-73 (C6 as amended 2026-10-21): a held file queued on hold has the hold as its verdict.
  const hold =
    ready && decided === null
      ? holdOfWait(store, id, () => store.testFileKeys.list(id, held), now)
      : null;
  const outcome: NamedWaitOutcome =
    liveness.state !== "alive" ? "no-daemon" : (decided ?? (hold !== null ? "on-hold" : "timeout"));
  const result = buildSnapshot(store, root, now);
  // Row 011-146 (C6 as amended 2026-10-23): the selected checks' focused answers; it requests nothing.
  const focus = snapshotFocus(store, id, root, own, checks);
  return {
    outcome,
    ...(hold === null ? {} : { hold }),
    ...(focus === undefined ? {} : { focus }),
    selection,
    leftForPause,
    verdict: readVerdict(store, id, held),
    files: readNamedFiles(store, id, root, selection.files, result.daemon, now),
    result,
    sync: current,
    snapshot: true,
  };
}

/** `squeal status [--json] [--full] <path>...`: `readNamedSnapshot`, then `printNamed`. */
export async function namedSnapshotCommand(
  paths: readonly string[],
  how: NamedPrint,
  io: CliIo,
  options: NamedSnapshotOptions,
): Promise<number> {
  const checks = how.checks ?? [];
  const snapshot = readNamedSnapshot(io.cwd ?? process.cwd(), paths, { ...options, checks });
  return printNamed(snapshot, how, io, options.now);
}
