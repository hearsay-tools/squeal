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
 * only where its path means this host's file (`own`): never for a foreign
 * record, which the manual prune judges by (a) alone.
 *
 * Review 0.1.667 B1: a daemon that cannot be read (its store unreadable,
 * corrupt or busy) keeps the machine, at the choice and at the claim.
 * N1: the automatic prune takes a record of no scope as its own, as it
 * claims it in the same run, so an old awake record is judged at once.
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
    }
  /** Review 0.1.667 B2: a record left `deleting` by a prune that ended before its release. */
  | { readonly kind: "unfinished" };

export const WORKTREE_REMOVED: PruneCause = { kind: "worktree-removed" };
export const UNFINISHED: PruneCause = { kind: "unfinished" };

/** A worktree's daemon: live, confirmed absent, or not readable (`recordedDaemonLiveness`). */
export type Liveness = "alive" | "absent" | "unknown";

const DAEMON_LIVE = "a daemon of its worktree is live";
const DAEMON_UNKNOWN = "its worktree's daemon could not be read";

export interface UnusedContext {
  readonly now: EpochMs;
  /** `remote.json`'s lanes: a record's limit is its lane's, as `reattach` finds it. */
  readonly lanes: Readonly<Record<string, RemoteLane>>;
  /** The prune's own scope: the daemon's, else this host's (`machineScope`). */
  readonly here: string;
  /** The automatic prune: a record of no scope is taken as its own. */
  readonly automatic: boolean;
  /** Whether a daemon of the worktree at `root` is live (`recordedDaemonLiveness`). */
  readonly daemonLive: (root: AbsolutePath) => Liveness;
}

/** When the daemon's exit left `record` with none: `detachedAt`, else (an older record) `lastUsedAt`. */
export function detachedSince(record: MachineRecord): EpochMs {
  return typeof record.detachedAt === "number" ? record.detachedAt : record.lastUsedAt;
}

/**
 * Why `record`, whose worktree is there, is unused now; `null` when it is
 * not; a string when it would be but is kept, and why.
 */
export function unusedCause(
  record: MachineRecord,
  context: UnusedContext,
): PruneCause | string | null {
  const lane = context.lanes[record.repositoryKey];
  if (lane === undefined || lane.provider !== record.provider) return null;
  const hours = deleteUnusedHoursOf(lane);
  if (!(hours > 0)) return null;
  let since: EpochMs;
  let how: "detached" | "crashed";
  if (record.status === "detached") {
    since = detachedSince(record);
    how = "detached";
  } else if (own(record, context) && record.status !== "deleting") {
    since = record.lastUsedAt;
    how = "crashed";
  } else return null;
  const idleMs = context.now - since;
  if (idleMs < hours * HOUR_MS) return null;
  const live = daemonOf(record, context);
  if (live === "alive") return null;
  if (live === "unknown") return DAEMON_UNKNOWN;
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
  const live = daemonOf(now, context);
  return live === "alive" ? DAEMON_LIVE : live === "unknown" ? DAEMON_UNKNOWN : null;
}

/** Whether `record`'s path is this host's: of the prune's scope, or (automatic, N1) of none. */
function own(record: MachineRecord, context: Pick<UnusedContext, "here" | "automatic">): boolean {
  return record.scope === context.here || (context.automatic && record.scope === undefined);
}

/** The daemon of `record`'s worktree, read only where its path is this host's; else `absent`. */
function daemonOf(
  record: MachineRecord,
  context: Pick<UnusedContext, "here" | "automatic" | "daemonLive">,
): Liveness {
  return own(record, context) ? context.daemonLive(record.worktreeRoot) : "absent";
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
  if (cause.kind === "unfinished")
    return `of worktree ${worktreeRoot}, whose delete was not finished`;
  const idle = durationText(cause.idleMs);
  return cause.how === "detached"
    ? `of worktree ${worktreeRoot}, no daemon for ${idle}`
    : `of worktree ${worktreeRoot}, no live daemon and unused for ${idle}`;
}
