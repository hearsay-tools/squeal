import type { AbsolutePath, EpochMs } from "../../types/common.js";
import type { MachineRecord } from "./provider.js";
import { deleteUnusedHoursOf, type RemoteLane } from "./settings.js";

/*
 * Row 026-43 (spec 026 D7.3 item 4, D12.5): a tracked machine whose
 * worktree is still there but which no daemon has used for its lane's
 * `deleteUnusedHours` is released `unused` (agent37: deleted) and
 * forgotten. It is unused when (a) it is `detached` and its `detachedAt`
 * (an older record: `lastUsedAt`) is that old, or (b) it is of the
 * prune's own scope, marked `awake` or `sleeping`, its `lastUsedAt` is
 * that old and its worktree has no live daemon: the daemon crashed. A
 * worktree's daemon is read only for a record already past the limit, and
 * only where its path means this host's file (`trusted`): never for a
 * foreign record, which the manual prune judges by (a) alone.
 */

const HOUR_MS = 3_600_000;

/** Why the prune releases a machine: its worktree is gone, or no daemon used it for the limit. */
export type PruneCause =
  | { readonly kind: "worktree-removed" }
  | {
      readonly kind: "unused";
      /** How long no daemon has used it. */
      readonly idleMs: number;
      /** `detached`: its daemon exited; `crashed`: marked in use, with no live daemon. */
      readonly how: "detached" | "crashed";
    };

export const WORKTREE_REMOVED: PruneCause = { kind: "worktree-removed" };

export interface UnusedContext {
  readonly now: EpochMs;
  /** `remote.json`'s lanes: a record's limit is its lane's, as `reattach` finds it. */
  readonly lanes: Readonly<Record<string, RemoteLane>>;
  /** The prune's own scope: the daemon's, else this host's (`machineScope`). */
  readonly here: string;
  /** The automatic prune: a record of no scope is taken as its own. */
  readonly automatic: boolean;
  /** Whether a daemon of the worktree at `root` is live (`liveDaemonRecorded`). */
  readonly daemonLive: (root: AbsolutePath) => boolean;
}

/** When the daemon's exit left `record` with none: `detachedAt`, else (an older record) `lastUsedAt`. */
export function detachedSince(record: MachineRecord): EpochMs {
  return typeof record.detachedAt === "number" ? record.detachedAt : record.lastUsedAt;
}

/** Why `record`, whose worktree is there, is unused now; `null` when it is not. */
export function unusedCause(record: MachineRecord, context: UnusedContext): PruneCause | null {
  const lane = context.lanes[record.repositoryKey];
  if (lane === undefined || lane.provider !== record.provider) return null;
  const hours = deleteUnusedHoursOf(lane);
  if (!(hours > 0)) return null;
  const own = record.scope === context.here;
  let since: EpochMs;
  let how: "detached" | "crashed";
  if (record.status === "detached") {
    since = detachedSince(record);
    how = "detached";
  } else if (own) {
    since = record.lastUsedAt;
    how = "crashed";
  } else return null;
  const idleMs = context.now - since;
  if (idleMs < hours * HOUR_MS) return null;
  if (liveDaemon(record, context)) return null;
  return { kind: "unused", idleMs, how };
}

/**
 * Why `now`, `record` as read again just before its release, is no longer
 * unused; `null` when it still is: the same machine in the same state,
 * and no daemon of its worktree live.
 */
export function stillUnused(
  record: MachineRecord,
  now: MachineRecord,
  context: Pick<UnusedContext, "here" | "automatic" | "daemonLive">,
): string | null {
  if (
    now.status !== record.status ||
    now.lastUsedAt !== record.lastUsedAt ||
    now.detachedAt !== record.detachedAt
  ) {
    return "it was used again";
  }
  return liveDaemon(now, context) ? "a daemon of its worktree is live" : null;
}

/** A live daemon of `record`'s worktree, read only where its path is this host's. */
function liveDaemon(
  record: MachineRecord,
  context: Pick<UnusedContext, "here" | "automatic" | "daemonLive">,
): boolean {
  const trusted =
    record.scope === context.here || (context.automatic && record.scope === undefined);
  return trusted && context.daemonLive(record.worktreeRoot);
}

/** `3 h 10 min`, `40 min`: whole minutes, rounded down. */
export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`;
}

/** `of removed worktree /w`, `of worktree /w, no daemon for 25 h 0 min`: the machine as a log names it. */
export function causeText(cause: PruneCause, worktreeRoot: string): string {
  if (cause.kind === "worktree-removed") return `of removed worktree ${worktreeRoot}`;
  const idle = durationText(cause.idleMs);
  return cause.how === "detached"
    ? `of worktree ${worktreeRoot}, no daemon for ${idle}`
    : `of worktree ${worktreeRoot}, no live daemon and unused for ${idle}`;
}
