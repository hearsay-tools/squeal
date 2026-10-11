import { setTimeout as sleep } from "node:timers/promises";
import type { AbsolutePath, RevisionNumber, SyncResponse } from "../core/types/index.js";
import { askDaemon, daemonSocket } from "./daemon-access.js";

/**
 * Where a wait's sync stands: `pending` until the daemon stored its pass;
 * `synced` with the revision that holds every change made before the
 * request, and the incarnation of the daemon that answered, which names
 * itself the writer of the re-key moves the wait reads from the store
 * (`incarnation`, task 001-268; `null` from a daemon before it, whose
 * moves no wait trusts), which says nothing of a successor: the wait
 * checks the record's writer and the registered daemon at every read
 * (`movesTrusted`, review waves 13ac and 13ad, B1);
 * `unsupported` when no daemon could sync (none listens, one from before
 * the request, or its pass failed), and the wait falls back to its settle
 * time.
 */
export type SyncState =
  | { readonly state: "pending" }
  | {
      readonly state: "synced";
      readonly revision: RevisionNumber;
      readonly incarnation: string | null;
    }
  | { readonly state: "unsupported" };

export interface DaemonSync {
  current(): SyncState;
  /** Stops asking; a request on the wire still ends within the CLI socket timeout. */
  stop(): void;
}

const UNSUPPORTED: SyncState = { state: "unsupported" };

/**
 * Lessons, defect 30: a wait that started right after an edit read the
 * revision before it as quiet, since the edit's revision committed 0.9 to
 * 3.1 s later on a loaded host. Asks the daemon of `root` for a
 * reconciliation pass (`sync`) in the background and polls it every
 * `pollMs` until the pass is stored. A daemon that went away meanwhile is
 * asked again where `daemonSocket` finds one now, a successor included.
 */
export function syncDaemon(root: AbsolutePath, pollMs: number): DaemonSync {
  let current: SyncState = { state: "pending" };
  let stopped = false;
  const isStopped = () => stopped;
  void (async () => {
    for (;;) {
      const outcome = await syncOnce(root, pollMs, isStopped);
      if (outcome !== "again") return outcome;
    }
  })().then(
    (outcome) => {
      current = outcome;
    },
    () => {
      current = UNSUPPORTED;
    },
  );
  return {
    current: () => current,
    stop: () => {
      stopped = true;
    },
  };
}

async function syncOnce(
  root: AbsolutePath,
  pollMs: number,
  stopped: () => boolean,
): Promise<SyncState | "again"> {
  const socketPath = await daemonSocket(root).catch(() => null);
  if (socketPath === null || stopped()) return UNSUPPORTED;
  const first = await askDaemon(socketPath, { type: "sync" }).catch(() => null);
  if (first === null || !first.ok || first.type !== "sync") return UNSUPPORTED;
  let state: SyncResponse = first;
  for (;;) {
    if (state.revision !== null) {
      const incarnation = state.moves === true ? (state.incarnation ?? null) : null;
      return { state: "synced", revision: state.revision, incarnation };
    }
    if (state.error !== null) return UNSUPPORTED;
    // Unref'd: a wait that ended does not keep the CLI alive for its sync.
    await sleep(pollMs, undefined, { ref: false });
    if (stopped()) return UNSUPPORTED;
    // A timeout is asked again; a daemon gone or replaced, which forgot the id, is synced anew.
    const next = await askDaemon(socketPath, {
      type: "sync-status",
      requestId: first.requestId,
    }).catch(() => undefined);
    if (next === undefined) continue;
    if (next === null || !next.ok || next.type !== "sync") return "again";
    state = next;
  }
}
