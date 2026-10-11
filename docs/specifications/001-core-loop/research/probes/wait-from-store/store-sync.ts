// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
//
// `waitForStatus`'s `sync` replaced by a store read: the daemon gives only the
// captured revision (`upTo`, as `sync` without `after` answers today, after its
// reconciliation pass and before any runner part); the CLI then polls the
// store until its refined revision reaches `upTo` and reads the prototype
// record in that one read transaction. No hold, no scheduler call.
import { setTimeout as sleep } from "node:timers/promises";
import type { DaemonSync, SyncState } from "../../../../../../src/cli/status-sync.js";
import type { RevisionNumber, Store, WorktreeId } from "../../../../../../src/core/types/index.js";
import { answerFromStore, readShadow } from "./shadow.js";

export interface StoreSyncLog {
  /** The shadow commit sequence each wait read beside its start view. */
  readonly sinceSeqs: number[];
  /** How each answer ended. */
  readonly outcomes: string[];
}

/**
 * A `sync` for `waitForStatus`. `captured` is the daemon's revision at the
 * request; `choreography` runs the probe's stimulus between the capture and
 * the reads, as the original reproductions ran it while the answer awaited
 * the runner part.
 */
export function storeSync(
  store: Store,
  worktreeId: WorktreeId,
  captured: () => RevisionNumber,
  choreography: (upTo: RevisionNumber) => Promise<void> = async () => {},
  log: StoreSyncLog = { sinceSeqs: [], outcomes: [] },
) {
  return (_root: unknown, pollMs: number, after: RevisionNumber): DaemonSync => {
    // `waitForStatus` calls this in the callback of its first read, so this
    // sequence is the one its start view saw: no commit runs in between.
    const sinceSeq = readShadow(store, worktreeId).seq;
    const upTo = captured();
    log.sinceSeqs.push(sinceSeq);
    let current: SyncState = { state: "pending" };
    let stopped = false;
    void (async () => {
      await choreography(upTo);
      for (;;) {
        if (stopped) return;
        const answer = answerFromStore(store, worktreeId, after, upTo, sinceSeq);
        if (answer.state === "refining") {
          await sleep(pollMs);
          continue;
        }
        log.outcomes.push(answer.state);
        current =
          answer.state === "incomplete"
            ? { state: "unsupported" }
            : { state: "synced", revision: upTo, rekeyed: answer.rekeyed };
        return;
      }
    })();
    return {
      current: () => current,
      stop: () => {
        stopped = true;
      },
    };
  };
}
