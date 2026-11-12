import { randomUUID } from "node:crypto";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunLog } from "../core/code/gate/evidence.js";
import type { GateRunReport } from "../core/code/gate/report.js";
import { RUNNER_NAMES } from "../core/code/gate/types.js";
import { resolveCommonDir, worktreeIdFor } from "../core/fs/git-layout.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { storePaths } from "../core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../core/types/common.js";

/*
 * #197 (row 020-40; the human, 2026-11-12: "Keep the log file"): the log
 * folder of a gate run in which a selected file failed or did not finish
 * is kept where a daemon keeps its runs' logs, `<store>/runs/<run-id>`
 * (spec 001 D1), named by a finished row of the main store's `runs`. The
 * store's prune (spec 001 D8) removes it as it removes a daemon run's log:
 * once it ended more than `store.retentionDays` ago, or at the next prune
 * when no daemon registered its worktree. The row is written first, so a
 * copied folder always has one: a folder no row names is never pruned.
 */

/**
 * How long the row's write waits for a busy store. It is written before the
 * report, so the wait is short: a busy store delays the verdict this much
 * at most, and only when a file failed or did not finish (D17.5's rule).
 */
export const LOG_BUSY_TIMEOUT_MS = 2_000;

export interface LogKeeping {
  /** Why a log was not kept, told once per run. */
  readonly note: (text: string) => void;
  readonly now?: () => EpochMs;
  /** Default `LOG_BUSY_TIMEOUT_MS`. */
  readonly busyTimeoutMs?: number;
}

/**
 * `CollectOptions.keepLog` for the worktree at `root`: the run's row in the
 * main store, created as a daemon creates it, then its log folder copied to
 * the folder the row names. `null`, with a note, when either fails.
 */
export function runLogKeeper(
  root: AbsolutePath,
  options: LogKeeping,
): (run: RunLog) => Promise<AbsolutePath | null> {
  const now = options.now ?? Date.now;
  return async ({ runner, files, logDir, report }) => {
    const notKept = (why: string) => {
      options.note(`${RUNNER_NAMES[runner]} run: its log was not kept: ${why}`);
      return null;
    };
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return notKept(`${root} has no git directory`);
    const busyTimeoutMs = options.busyTimeoutMs ?? LOG_BUSY_TIMEOUT_MS;
    const store = openStore(commonDir, { busyTimeoutMs });
    if (isStoreOpenFailure(store)) return notKept(`the store did not open: ${store.reason}`);
    const id = `gate-${randomUUID()}`;
    const path = join(storePaths(commonDir).runsDir, id);
    try {
      const worktreeId = worktreeIdFor(root);
      const endedAt = now();
      store.transaction(() => {
        const revision = store.revisions.latest(worktreeId)?.number ?? 0;
        const startedAt = endedAt - Math.round(report.durationMs);
        const checkpointId = null;
        store.runs.start({
          id,
          worktreeId,
          revision,
          testFiles: files,
          checkpointId,
          logDir: path,
          startedAt,
        });
        store.runs.finish(id, report.end, endedAt);
      });
    } catch (error) {
      return notKept(`the store did not take its run: ${messageOf(error)}`);
    } finally {
      store.close();
    }
    try {
      cpSync(logDir, path, { recursive: true });
      return path;
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      return notKept(`it was not copied: ${messageOf(error)}`);
    }
  };
}

/**
 * The stderr line after the verdict that names each kept log, by runner in
 * the report's order; `null` when none was kept.
 */
export function keptLogsLine(runs: readonly GateRunReport[]): string | null {
  const kept = runs.flatMap((run) =>
    run.log === undefined ? [] : [`${RUNNER_NAMES[run.runner]} ${run.log}`],
  );
  if (kept.length === 0) return null;
  const what = kept.length === 1 ? "log" : "logs";
  return `squeal code: ${what} of the failed or unfinished test files, kept until the store's prune: ${kept.join("; ")}\n`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
