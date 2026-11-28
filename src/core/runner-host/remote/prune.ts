import { recordedDaemonLiveness } from "../../daemon/ensure.js";
import type { AbsolutePath } from "../../types/common.js";
import { claimForDelete } from "./machine-claim.js";
import { changeMachinesSoon, forgettingClaim, readMachines } from "./machines-store.js";
import { machineScope, worktreePresence } from "./presence.js";
import type { MachineRecord, RemoteMachine, RemoteMachineProvider } from "./provider.js";
import { providerOf } from "./providers/index.js";
import {
  type Liveness,
  type PruneCause,
  UNFINISHED,
  type UnusedContext,
  unusedCause,
  WORKTREE_REMOVED,
} from "./prune-unused.js";
import { loadRemoteSettings } from "./settings.js";

/*
 * Spec 026 D12.5 (row 026-10), row 026-37 (#301): each tracked machine
 * whose worktree is gone is released `worktree-removed` (agent37: deleted)
 * and forgotten. `squeal remote prune` runs it; so does each daemon's
 * start, in the background, so a machine of a removed worktree stops
 * billing with no manual prune.
 *
 * Review 0.1.658: a worktree is gone only when its path is confirmed
 * missing (B2, `presence.ts`); one that cannot be checked is kept and
 * named. Just before each release the record is read again: it must still
 * name the same machine and its path must still be gone (B3). After the
 * release only that exact record is forgotten, compared inside the
 * registry lock, so a replacement written meanwhile stays. The registry
 * is written without blocking the thread (B4): while another writer holds
 * the lock the prune waits on a timer. `signal` ends the prune where it
 * stands: the release in flight is aborted in the provider too (B1), no
 * further release starts, and the uncertain record stays for the next
 * prune. N1: with `scope`, as the daemon's start gives it, only records
 * of that scope or of none are acted on; a record without one whose
 * worktree is here gets `scope` written into it. Review 0.1.659-r2 N1:
 * the scope is checked again on the record read just before its release,
 * and the record is forgotten only while its id and scope are unchanged.
 *
 * Row 026-43: the same prune releases `unused` and forgets a machine whose
 * worktree is there but which no daemon has used for its lane's
 * `deleteUnusedHours` (`prune-unused.ts`). Review 0.1.667 B2: before each
 * release the prune claims the record under the registry lock
 * (`machine-claim.ts`, status `deleting`), which a daemon's claim before
 * reuse excludes; an unused one is kept when its status or timestamps
 * moved, its id changed, or its worktree's daemon is live or unreadable.
 * Only the claimed record is released and forgotten. A record left
 * `deleting` by a prune that ended first is released by the next.
 */

/** One machine of a removed worktree or unused: released, would be (a dry run), kept and why, or failed. */
export type PruneOutcome =
  | {
      readonly kind: "released" | "would-release";
      readonly record: MachineRecord;
      readonly cause: PruneCause;
    }
  | { readonly kind: "kept"; readonly record: MachineRecord; readonly reason: string }
  | {
      readonly kind: "failed";
      readonly record: MachineRecord;
      readonly error: string;
      readonly cause: PruneCause;
    };

/** A machine to release, and why. */
interface Target {
  readonly record: MachineRecord;
  readonly cause: PruneCause;
}

export interface PruneOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly dryRun?: boolean;
  /** Ends the prune: no further release starts, and the one in flight is aborted. */
  readonly signal?: AbortSignal;
  /** Each machine's outcome, as it comes. */
  readonly report?: (outcome: PruneOutcome) => void;
  /** The provider of a kind. Default the built-in ones. */
  readonly providerOf?: (kind: string) => RemoteMachineProvider | null;
  /** N1: act only on records of this scope or of none. Absent: on every record (the manual prune). */
  readonly scope?: string;
  /** Row 026-43: whether a daemon of the worktree at `root` is live. Default `recordedDaemonLiveness`. */
  readonly daemonLive?: (root: AbsolutePath) => Liveness;
  /** The clock unused machines are timed by. Default `Date.now`. */
  readonly now?: () => number;
}

export interface PruneResult {
  /** The machines file could not be read: nothing was pruned. */
  readonly problem?: { readonly path: string; readonly text: string };
  /** The machines of removed worktrees found. */
  readonly gone: number;
  /** Row 026-43: the unused machines found. */
  readonly unused: number;
  readonly outcomes: readonly PruneOutcome[];
  /** `signal` ended the prune before every machine was released. */
  readonly aborted: boolean;
}

/** Releases and forgets each tracked machine whose worktree is gone (`worktree-removed`) or that is unused (`unused`). */
export async function pruneRemovedWorktrees(options: PruneOptions): Promise<PruneResult> {
  const { env, signal, scope } = options;
  const read = readMachines(env);
  if (read.problem !== undefined) {
    return {
      problem: { path: read.path, text: read.problem },
      gone: 0,
      unused: 0,
      outcomes: [],
      aborted: false,
    };
  }
  const outcomes: PruneOutcome[] = [];
  const note = (outcome: PruneOutcome) => {
    outcomes.push(outcome);
    options.report?.(outcome);
  };
  const context = unusedContext(options);
  const { targets, gone, claim } = sorted(read.machines, scope, context, note);
  const counts = { gone, unused: targets.length - gone };
  const aborted = () => ({ ...counts, outcomes, aborted: true });
  if (claim.length > 0 && options.dryRun !== true) {
    try {
      await changeMachinesSoon(env, claiming(claim, scope as string), signal);
    } catch {
      // Not claimed this time: the next start claims it. Nothing was released.
      if (signal?.aborted === true) return aborted();
    }
  }
  for (const { record, cause } of targets) {
    if (signal?.aborted === true) return aborted();
    if (options.dryRun === true) {
      note({ kind: "would-release", record, cause });
      continue;
    }
    const outcome = await releaseOne({ record, cause }, options, context);
    if (outcome === "aborted") return aborted();
    if (outcome !== null) note(outcome);
  }
  return { ...counts, outcomes, aborted: false };
}

/** Row 026-43: what judges a machine unused in this prune. */
function unusedContext(options: PruneOptions): UnusedContext {
  return {
    now: (options.now ?? Date.now)(),
    lanes: loadRemoteSettings(options.env).repositories,
    here: options.scope ?? machineScope(),
    automatic: options.scope !== undefined,
    daemonLive: options.daemonLive ?? ((root) => recordedDaemonLiveness(root)),
  };
}

/**
 * The machines to release, those of removed worktrees (`gone` of them)
 * first, then the unused; and those of no scope to claim. One whose
 * worktree cannot be checked is noted kept.
 */
function sorted(
  machines: readonly MachineRecord[],
  scope: string | undefined,
  context: UnusedContext,
  note: (outcome: PruneOutcome) => void,
): { targets: Target[]; gone: number; claim: MachineRecord[] } {
  const gone: Target[] = [];
  const unused: Target[] = [];
  const claim: MachineRecord[] = [];
  for (const record of machines) {
    if (scope !== undefined && (record.scope ?? scope) !== scope) continue;
    const presence = worktreePresence(record.worktreeRoot);
    if (presence === "gone") gone.push({ record, cause: WORKTREE_REMOVED });
    else if (presence === "unknown") note({ kind: "kept", record, reason: UNKNOWN });
    else {
      if (scope !== undefined && record.scope === undefined) claim.push(record);
      const cause = record.status === "deleting" ? UNFINISHED : unusedCause(record, context);
      if (typeof cause === "string") note({ kind: "kept", record, reason: cause });
      else if (cause !== null) unused.push({ record, cause });
    }
  }
  return { targets: [...gone, ...unused], gone: gone.length, claim };
}

/** Releases and forgets `target`'s record if it still stands; its outcome, `null` when it is no longer this prune's. */
async function releaseOne(
  target: Target,
  options: PruneOptions,
  context: UnusedContext,
): Promise<PruneOutcome | "aborted" | null> {
  const { env, signal } = options;
  const { record, cause } = target;
  // B3, 0.1.659-r2 N1, 0.1.667 B2: the record as it is now, claimed under the lock, not as first read.
  let now: MachineRecord | string | null;
  try {
    now = await claimForDelete(record, cause, { env, scope: options.scope, context, signal });
  } catch (error) {
    if (signal?.aborted === true) return "aborted";
    return { kind: "failed", record, error: `not claimed: ${message(error)}`, cause };
  }
  if (now === null) return null;
  if (typeof now === "string") return { kind: "kept", record, reason: now };
  let released = false;
  try {
    const machine = reattach(now, env, options.providerOf ?? providerOf);
    if (typeof machine === "string") throw new Error(machine);
    const reason = cause.kind === "worktree-removed" ? "worktree-removed" : "unused";
    if (!(await until(machine.release(reason, signal), signal))) return "aborted";
    released = true;
    await changeMachinesSoon(env, forgettingClaim(now), signal);
    return { kind: "released", record: now, cause };
  } catch (error) {
    if (signal?.aborted === true) return "aborted";
    const text = message(error);
    return {
      kind: "failed",
      record: now,
      error: released ? `released, not forgotten: ${text}` : text,
      cause,
    };
  }
}

const UNKNOWN = "its worktree could not be checked";

/** N1: the edit writing `scope` into each of `records` still without one. */
function claiming(
  records: readonly MachineRecord[],
  scope: string,
): (machines: readonly MachineRecord[]) => readonly MachineRecord[] {
  const ids = new Set(records.map((r) => `${r.provider}\0${r.worktreeId}\0${r.id}`));
  return (machines) =>
    machines.map((m) =>
      m.scope === undefined && ids.has(`${m.provider}\0${m.worktreeId}\0${m.id}`)
        ? { ...m, scope }
        : m,
    );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The machine of `record`, reached again with its `remote.json` entry's config; else why not. */
export function reattach(
  record: MachineRecord,
  env: NodeJS.ProcessEnv,
  providers: (kind: string) => RemoteMachineProvider | null = providerOf,
): RemoteMachine | string {
  const provider = providers(record.provider);
  if (provider === null) return `no remote provider "${record.provider}" in this Squeal`;
  const lane = loadRemoteSettings(env).repositories[record.repositoryKey];
  if (lane === undefined || lane.provider !== record.provider) {
    return `remote.json names no ${record.provider} lane for ${record.repositoryKey}`;
  }
  return provider.reattach(record, lane.providerConfig, env);
}

/**
 * True once `work` settles; false once `signal` aborts first. Rejects as
 * `work` does. The provider was given `signal` too (B1), so its own
 * request or hook ends; this only stops waiting for one that ignores it.
 */
function until(work: Promise<void>, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal === undefined) return work.then(() => true);
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      () => resolve(true),
      (error: unknown) => reject(error),
    );
    void work.catch(() => {}).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
