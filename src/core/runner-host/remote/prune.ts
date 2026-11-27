import { changeMachinesSoon, forgetting, readMachines } from "./machines-store.js";
import { worktreePresence } from "./presence.js";
import type { MachineRecord, RemoteMachine, RemoteMachineProvider } from "./provider.js";
import { providerOf } from "./providers/index.js";
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
 * worktree is here gets `scope` written into it.
 */

/** One machine of a removed worktree: released, would be (a dry run), kept and why, or failed. */
export type PruneOutcome =
  | { readonly kind: "released" | "would-release"; readonly record: MachineRecord }
  | { readonly kind: "kept"; readonly record: MachineRecord; readonly reason: string }
  | { readonly kind: "failed"; readonly record: MachineRecord; readonly error: string };

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
}

export interface PruneResult {
  /** The machines file could not be read: nothing was pruned. */
  readonly problem?: { readonly path: string; readonly text: string };
  /** The machines of removed worktrees found. */
  readonly gone: number;
  readonly outcomes: readonly PruneOutcome[];
  /** `signal` ended the prune before every machine was released. */
  readonly aborted: boolean;
}

/** Releases (`worktree-removed`) and forgets each tracked machine whose worktree is gone. */
export async function pruneRemovedWorktrees(options: PruneOptions): Promise<PruneResult> {
  const { env, signal, scope } = options;
  const read = readMachines(env);
  if (read.problem !== undefined) {
    return {
      problem: { path: read.path, text: read.problem },
      gone: 0,
      outcomes: [],
      aborted: false,
    };
  }
  const outcomes: PruneOutcome[] = [];
  const note = (outcome: PruneOutcome) => {
    outcomes.push(outcome);
    options.report?.(outcome);
  };
  const { gone, claim } = sorted(read.machines, scope, note);
  const aborted = () => ({ gone: gone.length, outcomes, aborted: true });
  if (claim.length > 0 && options.dryRun !== true) {
    try {
      await changeMachinesSoon(env, claiming(claim, scope as string), signal);
    } catch {
      // Not claimed this time: the next start claims it. Nothing was released.
      if (signal?.aborted === true) return aborted();
    }
  }
  for (const record of gone) {
    if (signal?.aborted === true) return aborted();
    if (options.dryRun === true) {
      note({ kind: "would-release", record });
      continue;
    }
    const outcome = await releaseOne(record, options);
    if (outcome === "aborted") return aborted();
    if (outcome !== null) note(outcome);
  }
  return { gone: gone.length, outcomes, aborted: false };
}

/** The records whose worktree is gone, and those of no scope to claim; one that cannot be checked is noted kept. */
function sorted(
  machines: readonly MachineRecord[],
  scope: string | undefined,
  note: (outcome: PruneOutcome) => void,
): { gone: MachineRecord[]; claim: MachineRecord[] } {
  const gone: MachineRecord[] = [];
  const claim: MachineRecord[] = [];
  for (const record of machines) {
    if (scope !== undefined && (record.scope ?? scope) !== scope) continue;
    const presence = worktreePresence(record.worktreeRoot);
    if (presence === "gone") gone.push(record);
    else if (presence === "unknown") note({ kind: "kept", record, reason: UNKNOWN });
    else if (scope !== undefined && record.scope === undefined) claim.push(record);
  }
  return { gone, claim };
}

/** Releases and forgets `record` if it still stands; its outcome, `null` when another prune took it. */
async function releaseOne(
  record: MachineRecord,
  options: PruneOptions,
): Promise<PruneOutcome | "aborted" | null> {
  const { env, signal } = options;
  // B3: the record as it is now, its machine and its path, not as the prune first read it.
  const why = stale(record, env);
  if (why === "forgotten") return null;
  if (why !== null) return { kind: "kept", record, reason: why };
  let released = false;
  try {
    const machine = reattach(record, env, options.providerOf ?? providerOf);
    if (typeof machine === "string") throw new Error(machine);
    if (!(await until(machine.release("worktree-removed", signal), signal))) return "aborted";
    released = true;
    await changeMachinesSoon(env, forgetting(record, { id: record.id }), signal);
    return { kind: "released", record };
  } catch (error) {
    if (signal?.aborted === true) return "aborted";
    const text = message(error);
    return { kind: "failed", record, error: released ? `released, not forgotten: ${text}` : text };
  }
}

const UNKNOWN = "its worktree could not be checked";

/** Why `record` is no longer to be released now, `"forgotten"` when no prune need say; else `null`. */
function stale(record: MachineRecord, env: NodeJS.ProcessEnv): string | null {
  const now = readMachines(env).machines.find(
    (m) => m.provider === record.provider && m.worktreeId === record.worktreeId,
  );
  if (now === undefined) return "forgotten";
  if (now.id !== record.id) return `replaced by machine ${now.id}`;
  const presence = worktreePresence(record.worktreeRoot);
  if (presence === "present") return "its worktree is there again";
  return presence === "unknown" ? UNKNOWN : null;
}

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
