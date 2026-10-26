import { worktreeIdFor } from "../core/fs/index.js";
import { askNamedRun } from "../core/retry/index.js";
import type { AbsolutePath, EpochMs, Store, WorktreeId } from "../core/types/index.js";
import { type AskedRun, type AskFile, askableState } from "./status-wait-ask.js";
import {
  BUSY_BOUND_MS,
  isBusyAnswer,
  openForWrites,
  tellDaemonRetries,
  whileBusy,
} from "./store-writes.js";

/*
 * Row 011-207: how a named wait stores the runs it asks (011 C15), outside
 * its read's transaction. Row 011-241 moved it from `status-wait-ask.ts`.
 */

/** How a named wait stores its asks (`NamedWaitOptions.ask`). */
export type AskNamed = (
  root: AbsolutePath,
  files: readonly AskFile[],
  asker: string,
  withinMs: number,
  now: () => EpochMs,
) => Promise<readonly AskedRun[]>;

/**
 * Whether `file` still qualifies as its read found it, read in the write's
 * transaction (review 0.1.322 B1): its row at the same key, and
 * `askableState`'s checks.
 */
function stillAskable(store: Store, worktreeId: WorktreeId, file: AskFile, now: EpochMs) {
  const [row] = store.testFileKeys.list(worktreeId, [file.testFile]);
  if (row === undefined || row.key !== file.key) return false;
  const own = store.knownStates.list(worktreeId, [file.testFile]);
  return askableState(store, worktreeId, row, own, now) !== null;
}

/**
 * Stores one request per file as `askNamedRun` decides, each within the
 * busy bound or what is left of the wait, then tells the daemon as `retry`
 * does, so the run need not wait for its next pass. A worktree without a
 * store asks nothing.
 */
export const askNamedRuns: AskNamed = async (root, files, asker, withinMs, now) => {
  const store = openForWrites(root);
  if (store === null) return [];
  const deadline = (Date.now() + Math.max(1, Math.min(BUSY_BOUND_MS, withinMs))) as EpochMs;
  const worktreeId = worktreeIdFor(root);
  const runs: AskedRun[] = [];
  try {
    for (const file of files) {
      // Its run starts at once whatever the reason; the record keeps one for older readers.
      const ask = { ...file, session: asker, reason: "environment" as const, worktreeId };
      // Each try reads the file again under the write lock.
      const answer = whileBusy(store, deadline, () =>
        askNamedRun(store, { ...ask, at: Date.now() as EpochMs }, () =>
          stillAskable(store, worktreeId, file, now()),
        ),
      );
      runs.push(
        isBusyAnswer(answer)
          ? { ...file, answer: "busy" }
          : answer.kind === "queued" || answer.kind === "joined"
            ? { ...file, answer: answer.kind, record: answer.record.id }
            : { ...file, answer: answer.kind },
      );
    }
  } finally {
    store.close();
  }
  if (runs.some((r) => r.answer === "queued")) await tellDaemonRetries(root);
  return runs;
};
