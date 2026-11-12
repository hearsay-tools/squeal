import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { type DaemonRequestError, requestDaemon } from "../../daemon/client.js";
import { heartbeatFresh } from "../../presence/heartbeat.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../types/common.js";
import type { DaemonRequest, DaemonResponse } from "../../types/daemon.js";
import type { KeepResponse, KeepWrite } from "../../types/daemon-writes.js";
import type { Store } from "../../types/store.js";
import type { KeepWriter, Tried } from "./keep-write.js";

/** How long the keeper waits for the daemon (review 0.1.450 B2). */
export interface DaemonWaits {
  /** One socket request's answer, which the desk gives from memory. */
  readonly answerMs: number;
  /** Asking again, by the try's id, how a try whose answer was lost went. */
  readonly reconcileMs: number;
}

export const DAEMON_WAITS: DaemonWaits = { answerMs: 2_000, reconcileMs: 10_000 };

/** Pauses between asks of how a try goes: a try waits one busy slice at most. */
const STATUS_PAUSES_MS = [5, 10, 25, 50] as const;

/** Pause between asks again after a lost answer. */
const RECONCILE_PAUSE_MS = 250;

/** The 020-28 note for a daemon that keeps the files: one before this request answers so. */
export const DAEMON_KEEPS_ITS_OWN = "a daemon runs in this worktree, and it keeps its own";

/** Socket errors that prove the request never reached a daemon. */
const NOT_REACHED: ReadonlySet<string> = new Set(["ENOENT", "ECONNREFUSED"]);

/**
 * Review 0.1.450 B2: a try the daemon took whose outcome it did not say
 * within `DaemonWaits.reconcileMs`; the write may have landed.
 */
export class KeepUnknown extends Error {}

/** A refusal the daemon gave: nothing was written. */
class KeepRefused extends Error {}

/**
 * Spec 021 D15 (row 021-20, part two): the keeper's writer while a daemon
 * holds the worktree's lock and serves it: each try of a file's coverage
 * record or results is a `keep` request with an id of its own, which the
 * daemon runs once in its retried path. The keeper's wait, its bound, its
 * notes and its check of the inputs after each pause stay with the keeper
 * (`keepFile`). Review 0.1.450 B2: an answer lost on the way back is asked
 * again by that id; the daemon runs one id once, so asking never writes
 * twice. A try the daemon does not know ran nowhere and is `lost`, so the
 * keeper tries anew; one it does not tell of within the bound is
 * `KeepUnknown`. B1: a refusal says why, and only a daemon before this
 * request gives the 020-28 note.
 */
export function writeThroughDaemon(target: {
  readonly socketPath: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly storeSchema: number;
  readonly waits?: DaemonWaits;
}): KeepWriter {
  const { socketPath, worktreeId, storeSchema } = target;
  const waits = target.waits ?? DAEMON_WAITS;
  const ask = (request: DaemonRequest) => requestDaemon(socketPath, request, waits.answerMs);

  /** How try `id` went, asked again until the bound while its answers are lost. */
  const statusOf = async (id: string): Promise<KeepResponse | "lost"> => {
    const until = Date.now() + waits.reconcileMs;
    for (;;) {
      let why: string;
      try {
        const answer = await ask({ type: "keep-status", requestId: id });
        if (isKeep(answer)) return answer;
        if (!answer.ok && answer.error.startsWith("unknown request id")) return "lost";
        why = whyNot(answer);
      } catch (error) {
        why = (error as Error).message;
      }
      if (Date.now() >= until) {
        throw new KeepUnknown(`the daemon took the write and did not say how it went: ${why}`);
      }
      await sleep(RECONCILE_PAUSE_MS);
    }
  };

  const tryOnce = async (write: KeepWrite): Promise<Tried> => {
    const id = randomUUID();
    let state: KeepResponse | "lost";
    try {
      const answer = await ask({ type: "keep", id, worktreeId, storeSchema, write });
      if (!isKeep(answer)) throw refusal(answer);
      state = answer;
    } catch (error) {
      if (error instanceof KeepRefused) throw error;
      const { code, message } = error as DaemonRequestError;
      if (NOT_REACHED.has(code)) throw new Error(`the daemon did not answer: ${message}`);
      // Sent, its answer lost: it may have run.
      state = await statusOf(id);
    }
    for (let n = 0; state !== "lost" && state.outcome === null; n++) {
      await sleep(STATUS_PAUSES_MS[Math.min(n, STATUS_PAUSES_MS.length - 1)]);
      state = await statusOf(id);
    }
    if (state === "lost" || state.outcome === null) return "lost";
    const { outcome } = state;
    if ("failed" in outcome) throw new Error(outcome.failed);
    return outcome.kept ? "kept" : "busy";
  };

  return {
    coverage: (file) => tryOnce({ kind: "coverage", key: file.key, record: file.record }),
    results: (file, records, keys) =>
      tryOnce({
        kind: "results",
        key: file.key,
        records,
        paths: file.paths,
        environmentFiles: keys.environmentFiles(file.ref.project),
      }),
  };
}

/**
 * Spec 021 D15 (row 021-20, part two): while a daemon holds the worktree's
 * lock, it writes the kept files when it serves (its heartbeat is fresh);
 * `null` when none does, and nothing is kept, as before this row.
 */
export function sentWriter(
  store: Store,
  worktreeId: WorktreeId,
  now: EpochMs,
  waits?: DaemonWaits,
): KeepWriter | null {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (daemon === null || !heartbeatFresh(daemon, now)) return null;
  const { socketPath } = daemon;
  const storeSchema = store.schemaVersion;
  return writeThroughDaemon({ socketPath, worktreeId, storeSchema, ...(waits ? { waits } : {}) });
}

/** The daemon's refusal of a try: the 020-28 note for one before this request, else its words. */
function refusal(answer: DaemonResponse): KeepRefused {
  const why = whyNot(answer);
  const older = why === 'unknown request type "keep"' || why === "this daemon takes no kept files";
  return new KeepRefused(older ? DAEMON_KEEPS_ITS_OWN : `the daemon refused the write: ${why}`);
}

function isKeep(answer: DaemonResponse): answer is KeepResponse {
  return answer.ok && answer.type === "keep";
}

function whyNot(answer: DaemonResponse): string {
  return answer.ok ? `it answered ${answer.type}` : answer.error;
}
