import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../../daemon/client.js";
import { heartbeatFresh } from "../../presence/heartbeat.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../types/common.js";
import type { DaemonResponse } from "../../types/daemon.js";
import type { KeepResponse, KeepWrite } from "../../types/daemon-writes.js";
import type { Store } from "../../types/store.js";
import type { KeepWriter } from "./keep-write.js";

/** How long one socket request waits for the desk's answer, which comes from memory. */
const ANSWER_MS = 2_000;

/** Pauses between asks of how a try goes: a try waits one busy slice at most. */
const STATUS_PAUSES_MS = [5, 10, 25, 50] as const;

/** The 020-28 note for a daemon that keeps the files: one before this request answers so. */
export const DAEMON_KEEPS_ITS_OWN = "a daemon runs in this worktree, and it keeps its own";

/**
 * Spec 021 D15 (row 021-20, part two): the keeper's writer while a daemon
 * holds the worktree's lock and serves it: each try of a file's coverage
 * record or results is a `keep` request, which the daemon runs once in its
 * retried path. The keeper's wait, its bound, its notes and its check of
 * the inputs after each busy pause stay with the keeper (`keepFile`). A
 * daemon that refuses the request (one before it, a stopping one, another
 * store schema) keeps nothing of the gate's, as before this row; one that
 * took it and stopped answering fails the files not yet written.
 */
export function writeThroughDaemon(target: {
  readonly socketPath: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
}): KeepWriter {
  const { socketPath, worktreeId, storeSchema } = target;
  const ask = async (write: KeepWrite): Promise<boolean> => {
    const request = { type: "keep", worktreeId, storeSchema, write } as const;
    const answer = await requestDaemon(socketPath, request, ANSWER_MS);
    if (!isKeep(answer)) throw new Error(DAEMON_KEEPS_ITS_OWN);
    let state = answer;
    for (let n = 0; state.outcome === null; n++) {
      await sleep(STATUS_PAUSES_MS[Math.min(n, STATUS_PAUSES_MS.length - 1)]);
      const next = await requestDaemon(
        socketPath,
        { type: "keep-status", requestId: answer.requestId },
        ANSWER_MS,
      );
      if (!isKeep(next)) throw new Error(`the daemon stopped answering (${whyNot(next)})`);
      state = next;
    }
    const { outcome } = state;
    if ("failed" in outcome) throw new Error(outcome.failed);
    return outcome.kept;
  };
  return {
    coverage: (file) => ask({ kind: "coverage", key: file.key, record: file.record }),
    results: (file, records, keys) =>
      ask({
        kind: "results",
        records,
        paths: file.paths,
        environmentFiles: keys.environmentFiles(file.ref.project),
      }),
  };
}

function isKeep(answer: DaemonResponse): answer is KeepResponse {
  return answer.ok && answer.type === "keep";
}

function whyNot(answer: DaemonResponse): string {
  return answer.ok ? `it answered ${answer.type}` : answer.error;
}

/**
 * Spec 021 D15 (row 021-20, part two): while a daemon holds the worktree's
 * lock, it writes the kept files when it serves (its heartbeat is fresh);
 * `null` when none does, and nothing is kept, as before this row.
 */
export function sentWriter(store: Store, worktreeId: WorktreeId, now: EpochMs): KeepWriter | null {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon === null || !heartbeatFresh(daemon, now)) return null;
  const { socketPath } = daemon;
  return writeThroughDaemon({ socketPath, worktreeId, storeSchema: store.schemaVersion });
}
