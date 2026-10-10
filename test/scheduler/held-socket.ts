import { onTestFinished, vi } from "vitest";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { SyncRequests } from "../../src/core/daemon/sync-requests.js";
import { Discharges } from "../../src/core/scheduler/discharges.js";
import { type FileState, newFileState } from "../../src/core/scheduler/files.js";
import type {
  DaemonResponse,
  EpochMs,
  RevisionNumber,
  SyncResponse,
} from "../../src/core/types/index.js";
import type { Harness } from "./helpers.js";

/*
 * The real socket handlers routing `sync` into `Scheduler.rekeyedOnceRefined`
 * through a `SyncRequests`, as the daemon wires them (its reconciliation pass
 * aside), for the held-answer tests (review wave-13r B2, task 001-226;
 * review wave-13s B2, task 001-229).
 */

export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function asSync(response: DaemonResponse): SyncResponse {
  if (!response.ok || response.type !== "sync") throw new Error(JSON.stringify(response));
  return response;
}

/** The scheduler's own `Discharges`, once it took a hold. */
export function spyDischarges(): { discharges?: Discharges } {
  const instance: { discharges?: Discharges } = {};
  const hold = Discharges.prototype.hold;
  vi.spyOn(Discharges.prototype, "hold").mockImplementation(function (this: Discharges, ...args) {
    instance.discharges = this;
    return hold.apply(this, args);
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  return instance;
}

/** Holds the runner part of the next revision that changes `path` until `release`. */
export function stallRefinement(h: Harness, path: string): { release: () => void } {
  let release = () => {};
  const refinement = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(release);
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = async (paths) => {
    if (paths.some((changed) => changed.path === path)) await refinement;
    return invalidate(paths);
  };
  return { release: () => release() };
}

/** A file whose key moved at `revision`, to discharge synthetically. */
export function moved(path: string, revision: RevisionNumber): FileState {
  return { ...newFileState({ project: "", path }), keyedAt: revision, lastKeyedAt: revision };
}

export function syncSocket(h: Harness) {
  const syncs = new SyncRequests();
  /** How each answer ended: `answered`, or its error's message. */
  const ended = new Map<string, string>();
  const handle = createHandlers({
    worktreeId: h.worktreeId,
    root: h.root as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    phase: () => "ready",
    requestFullSuite: () => new Promise(() => {}),
    requestSync: (after, resolvedSince, id) => {
      const answer = syncs.run(id, async (signal) => {
        const upTo = h.scheduler.status().revision;
        if (after === null) return { revision: upTo, rekeyed: null };
        const rekeyed = await h.scheduler.rekeyedOnceRefined(
          after,
          upTo,
          resolvedSince ?? undefined,
          signal,
        );
        return { revision: upTo, rekeyed };
      });
      answer.then(
        () => ended.set(id, "answered"),
        (error: Error) => ended.set(id, error.message),
      );
      return answer;
    },
    forgetSync: (id) => syncs.forget(id),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
  return {
    syncs,
    ended,
    handle,
    status: (requestId: string) => asSync(handle({ type: "sync-status", requestId })),
    /** A `sync` from revision 0 naming what resolved since `since`; its request id. */
    sync: (since: EpochMs) =>
      asSync(handle({ type: "sync", after: 0, resolvedSince: since })).requestId,
  };
}
