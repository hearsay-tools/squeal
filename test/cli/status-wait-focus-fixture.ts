import type { CliIo } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import type { NamedWaitOptions } from "../../src/cli/status-wait-paths.js";
import type { FocusReply } from "../../src/cli/status-wait-promote.js";
import type { FocusedRun } from "../../src/core/scheduler/focused-row.js";
import type { CheckKey, RevisionNumber, Store, TestFileRef } from "../../src/core/types/index.js";
import { focusedRun, writeRuns } from "../status/focused-fixture.js";
import { A, NOW } from "./status-wait-fixture.js";

/*
 * Row 011-146: a named wait with `--check` against the status-wait fixture's
 * worktree, and a daemon that answers `focus` and writes its focused run in
 * the meta row, as row 011-145's daemon does.
 */

/** A's key while it is queued, as `repoWith` writes it. */
export const A_QUEUED = `key-${A}-queued` as CheckKey;
/** A's key once its run ended, as `finish` writes it. */
export const A_DONE = `key-${A}-done` as CheckKey;

export type SentFocus = {
  readonly files: readonly TestFileRef[];
  readonly texts: readonly string[];
  readonly withinMs: number;
};

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/**
 * Wait options whose daemon is synced at revision 4, records each focus
 * and promotion it is sent, answers `reply`, and then writes `run` (A's
 * focused run at its queued key, unless it says otherwise) into the row.
 */
export function focusing(
  store: Store,
  worktreeId: string,
  run: (Partial<FocusedRun> & { fails?: readonly string[]; passes?: readonly string[] }) | null,
  reply: FocusReply = "accepted",
  timeoutMs = 3_000,
) {
  const sent: SentFocus[] = [];
  const promoted: (readonly TestFileRef[])[] = [];
  const options: NamedWaitOptions = {
    timeoutMs,
    pollMs: 20,
    settleMs: 100,
    now: () => NOW,
    sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
    promote: (_root, files) => promoted.push(files),
    focus: async (_root, files, texts, withinMs) => {
      sent.push({ files, texts, withinMs });
      if (run !== null) {
        setTimeout(
          () => writeRuns(store, worktreeId, [focusedRun(A, { key: A_QUEUED, ...run })]),
          30,
        );
      }
      return reply;
    },
  };
  return { options, sent, promoted };
}

/** An io that keeps what the command printed. */
export function capture(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    cwd,
    env: {},
    now: () => NOW,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}
