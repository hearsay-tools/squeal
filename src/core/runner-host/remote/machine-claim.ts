import type { EpochMs } from "../../types/common.js";
import { changeMachinesSoon, claimForUse, forgettingClaim } from "./machines-store.js";
import { worktreePresence } from "./presence.js";
import type { MachineRecord, RemoteMachineProvider } from "./provider.js";
import { type PruneCause, stillUnused, type UnusedContext } from "./prune-unused.js";

/*
 * Row 026-43 (review 0.1.667 B2): a daemon and the prune of unused
 * machines exclude each other through the registry, under its lock. The
 * prune moves a record to `deleting` only while its id, status and
 * timestamps are as it judged them; a daemon, before it acquires (which
 * may reuse the tracked machine) or wakes its machine, marks the record
 * `awake` and used now, so the first of the two wins. A daemon that meets
 * `deleting` never reuses that machine: it releases it (`unused`) and
 * forgets that claim, so a prune that ended before its release leaves no
 * machine billing untracked, then acquires a new one. The prune releases
 * only the record it claimed and forgets only that claim
 * (`forgettingClaim`); a `deleting` record a prune left is claimed again
 * by the next.
 */

export interface ClaimBeforeUse {
  readonly key: Pick<MachineRecord, "provider" | "worktreeId">;
  readonly provider: RemoteMachineProvider;
  readonly config: Readonly<Record<string, unknown>>;
  readonly env: NodeJS.ProcessEnv;
  readonly at: EpochMs;
  readonly signal?: AbortSignal;
  readonly log: (line: string) => void;
}

/**
 * Claims the worktree's record for its daemon. Resolves the id of a
 * machine a prune was deleting, released and forgotten here, else `null`.
 * Rejects when the registry stays locked, `signal` aborts, or that
 * release fails: the record then stays `deleting` for the next prune.
 */
export async function claimBeforeUse(options: ClaimBeforeUse): Promise<string | null> {
  const { env, signal } = options;
  const found = await claimForUse(options.key, options.at, env, signal);
  if (found?.status !== "deleting") return null;
  const doomed = options.provider.reattach(found, options.config, env);
  await doomed.release("unused", signal);
  await changeMachinesSoon(env, forgettingClaim(found), signal);
  options.log(`remote machine ${found.id} was being deleted; released it, acquiring another`);
  return found.id;
}

const UNCHECKED = "its worktree could not be checked";

/**
 * The prune's claim of `record`, chosen for `cause`: under the registry
 * lock, the record as it is now moves to `deleting` while it is still to
 * be released, and the claim resolves; else why it is kept, or `null`
 * when it is gone or (with `scope`, the automatic prune) another scope's.
 * One already `deleting` is claimed as it is: no daemon reuses it. An
 * unused one must still be unused, its daemon read under the lock
 * (`stillUnused`). Rejects as `changeMachinesSoon` does.
 */
export async function claimForDelete(
  record: MachineRecord,
  cause: PruneCause,
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly scope: string | undefined;
    readonly context: UnusedContext;
    readonly signal: AbortSignal | undefined;
  },
): Promise<MachineRecord | string | null> {
  let result: MachineRecord | string | null = null;
  await changeMachinesSoon(
    options.env,
    (machines) =>
      machines.map((now) => {
        if (now.provider !== record.provider || now.worktreeId !== record.worktreeId) return now;
        const why = keptBecause(record, cause, now, options);
        if (why !== undefined) {
          result = why;
          return now;
        }
        result = now.status === "deleting" ? now : { ...now, status: "deleting" };
        return result;
      }),
    options.signal,
  );
  return result;
}

/** Why `now` is not to be claimed for `cause`, `null` when it is not this prune's; `undefined`: claim it. */
function keptBecause(
  record: MachineRecord,
  cause: PruneCause,
  now: MachineRecord,
  options: { readonly scope: string | undefined; readonly context: UnusedContext },
): string | null | undefined {
  const { scope } = options;
  if (scope !== undefined && (now.scope ?? scope) !== scope) return null;
  if (now.id !== record.id) return `replaced by machine ${now.id}`;
  if (now.status === "deleting") return undefined;
  if (cause.kind === "unfinished") return "it was used again";
  if (cause.kind === "unused") return stillUnused(record, now, options.context) ?? undefined;
  const presence = worktreePresence(now.worktreeRoot);
  if (presence === "present") return "its worktree is there again";
  return presence === "unknown" ? UNCHECKED : undefined;
}
