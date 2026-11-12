import { randomUUID } from "node:crypto";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunLog } from "../core/code/gate/evidence.js";
import type { GateRunReport } from "../core/code/gate/report.js";
import { RUNNER_NAMES } from "../core/code/gate/types.js";
import { readPolicy } from "../core/daemon/policy.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../core/types/common.js";
import type { Store } from "../core/types/store.js";

/*
 * #197 (row 020-40; the human, 2026-11-12: "Keep the log file"): the log
 * folder of a gate run in which a selected file failed or did not finish
 * is kept where a daemon keeps its runs' logs, `<store>/runs/<run-id>`
 * (spec 001 D1), named by a finished row of the main store's `runs`. The
 * store's prune (spec 001 D8) removes it as it removes a daemon run's log:
 * once it ended more than `store.retentionDays` ago, or at the next prune
 * when no daemon registered its worktree. The row is written first, and read
 * again after the copy, so a kept folder always has one: a folder no row
 * names is never pruned.
 */

/**
 * How long the row's write waits for a busy store. It is written before the
 * report, which names the folder, so a busy store delays the verdict this
 * much at most, and only when a file failed or did not finish: the one
 * exception to D17.5's "a busy store never delays the verdict" (the
 * coordinator, 2026-11-12).
 */
export const LOG_BUSY_TIMEOUT_MS = 2_000;

/**
 * How long a kept log stays: `days`, `store.retentionDays` here, where a
 * daemon registered the worktree; `next-prune` where none did, so any
 * daemon of the repository removes it at its next prune, within an hour.
 */
export type LogRetention = { readonly days: number } | "next-prune";

export interface LogKeeping {
  /** Why a log was not kept, told once per run. */
  readonly note: (text: string) => void;
  readonly now?: () => EpochMs;
  /** Default `LOG_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
}

export interface LogKeeper {
  /**
   * `CollectOptions.keepLog` for the worktree: the runs' row in the main
   * store, created as a daemon creates a run's, then each of their log
   * folders copied into the one folder the row names. `null`, with a note,
   * when the store does not open, either fails, or the row is gone after
   * the copy: a store failure costs the log, never the report.
   */
  readonly keep: (run: RunLog) => Promise<AbsolutePath | null>;
  /** How long the logs kept so far stay, as the last row write found it; `null` before one. */
  readonly retention: () => LogRetention | null;
}

/** The keeper of the logs of the gate's runs in the worktree at `root`. */
export function runLogKeeper(root: AbsolutePath, options: LogKeeping): LogKeeper {
  const now = options.now ?? Date.now;
  let retention: LogRetention | null = null;
  const keep = async (run: RunLog) => {
    const notKept = (why: string) => {
      options.note(`${RUNNER_NAMES[run.runner]} run: its log was not kept: ${why}`);
      return null;
    };
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return notKept(`${root} has no git directory`);
    const store = openFor(commonDir, options.busyTimeoutMs ?? LOG_BUSY_TIMEOUT_MS);
    if (typeof store === "string") return notKept(`the store did not open: ${store}`);
    const id = `gate-${randomUUID()}`;
    const path = join(storePaths(commonDir).runsDir, id);
    try {
      let registered: boolean;
      try {
        registered = finishRun(store, run, { id, root, logDir: path, endedAt: now() });
      } catch (error) {
        return notKept(`the store did not take its run: ${messageOf(error)}`);
      }
      const unowned = copyOwned(store, id, run.logDirs, path);
      if (unowned !== null) {
        rmSync(path, { recursive: true, force: true });
        return notKept(unowned);
      }
      retention = registered ? { days: readPolicy(root).store.retentionDays } : "next-prune";
      return path;
    } finally {
      store.close();
    }
  };
  return { keep, retention: () => retention };
}

/**
 * Writes the run's row, started and finished in one transaction, so no
 * reader sees it open; whether a daemon registered the worktree.
 */
function finishRun(
  store: Store,
  { files, report }: RunLog,
  row: { id: string; root: AbsolutePath; logDir: string; endedAt: EpochMs },
): boolean {
  const worktreeId = worktreeIdFor(row.root);
  return store.transaction(() => {
    const revision = store.revisions.latest(worktreeId)?.number ?? 0;
    const startedAt = row.endedAt - Math.round(report.durationMs);
    store.runs.start({
      id: row.id,
      worktreeId,
      revision,
      testFiles: files,
      checkpointId: null,
      logDir: row.logDir,
      startedAt,
    });
    store.runs.finish(row.id, report.end, row.endedAt);
    return store.worktrees.get(worktreeId) !== null;
  });
}

/**
 * The main store, with `busyTimeoutMs`; why not, when it did not open. A busy
 * open throws, as when another opener holds the write lock of a new store's
 * schema, and costs the log only (review 0.1.462 B1).
 */
function openFor(commonDir: AbsolutePath, busyTimeoutMs: number): Store | string {
  try {
    const store = openStore(commonDir, { busyTimeoutMs });
    return isStoreOpenFailure(store) ? store.reason : store;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Copies `logDirs` into `path`, then reads that the run `id` still names it;
 * why not, when either fails. The row is committed first, so a daemon's
 * prune can remove it, and its folder, before or during the copy: then the
 * copy is a folder no row names, which no prune removes (review 0.1.462 B2).
 * After the read, a prune that removes the row removes the whole copy. No
 * write transaction is held while copying.
 */
function copyOwned(
  store: Store,
  id: string,
  logDirs: readonly AbsolutePath[],
  path: string,
): string | null {
  try {
    for (const logDir of logDirs) cpSync(logDir, path, { recursive: true });
  } catch (error) {
    return `it was not copied: ${messageOf(error)}`;
  }
  try {
    if (store.runs.get(id) === null) {
      return "the store's prune removed its run before the copy ended";
    }
  } catch (error) {
    return `its run was not read after the copy: ${messageOf(error)}`;
  }
  return null;
}

/**
 * The stderr line after the verdict that names each kept log, by runner in
 * the report's order, and how long they stay; `null` when none was kept.
 */
export function keptLogsLine(
  runs: readonly GateRunReport[],
  retention: LogRetention | null,
): string | null {
  const kept = runs.flatMap((run) =>
    run.log === undefined ? [] : [`${RUNNER_NAMES[run.runner]} ${run.log}`],
  );
  if (kept.length === 0) return null;
  const what = kept.length === 1 ? "log" : "logs";
  return `squeal code: ${what} of the failed or unfinished test files, ${stays(retention)}: ${kept.join("; ")}\n`;
}

function stays(retention: LogRetention | null): string {
  if (retention === null) return "kept until the store's prune";
  if (retention === "next-prune") {
    return "kept until the next prune, within about 1 h while a daemon of this repository runs (none serves this worktree)";
  }
  return `kept ${retention.days === 1 ? "1 day" : `${retention.days} days`} (store.retentionDays)`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
