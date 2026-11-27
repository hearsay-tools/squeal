import { existsSync } from "node:fs";
import { forgetMachine, readMachines } from "./machines-store.js";
import type { MachineRecord, RemoteMachine, RemoteMachineProvider } from "./provider.js";
import { providerOf } from "./providers/index.js";
import { loadRemoteSettings } from "./settings.js";

/*
 * Spec 026 D12.5 (row 026-10), row 026-37 (#301): each tracked machine
 * whose worktree is gone is released `worktree-removed` (agent37: deleted)
 * and forgotten. `squeal remote prune` runs it; so does each daemon's
 * start, in the background, so a machine of a removed worktree stops
 * billing with no manual prune. Several daemons may prune at once: a
 * machine already deleted is released all the same (agent37 `404`), and
 * forgetting a record twice changes nothing. `signal` ends the prune
 * where it stands: a release in flight is no longer waited for, and its
 * record stays tracked for the next prune.
 */

/** One machine of a removed worktree: released, would be (a dry run), or not released and why. */
export type PruneOutcome =
  | { readonly kind: "released" | "would-release"; readonly record: MachineRecord }
  | { readonly kind: "failed"; readonly record: MachineRecord; readonly error: string };

export interface PruneOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly dryRun?: boolean;
  /** Ends the prune: no further release starts, and one in flight is no longer waited for. */
  readonly signal?: AbortSignal;
  /** Each machine's outcome, as it comes. */
  readonly report?: (outcome: PruneOutcome) => void;
  /** The provider of a kind. Default the built-in ones. */
  readonly providerOf?: (kind: string) => RemoteMachineProvider | null;
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
  const { env, signal } = options;
  const read = readMachines(env);
  if (read.problem !== undefined) {
    return {
      problem: { path: read.path, text: read.problem },
      gone: 0,
      outcomes: [],
      aborted: false,
    };
  }
  const gone = read.machines.filter((m) => !existsSync(m.worktreeRoot));
  const outcomes: PruneOutcome[] = [];
  const note = (outcome: PruneOutcome) => {
    outcomes.push(outcome);
    options.report?.(outcome);
  };
  for (const record of gone) {
    if (signal?.aborted === true) break;
    if (options.dryRun === true) {
      note({ kind: "would-release", record });
      continue;
    }
    try {
      const machine = reattach(record, env, options.providerOf ?? providerOf);
      if (typeof machine === "string") throw new Error(machine);
      if (!(await until(machine.release("worktree-removed"), signal))) break;
      forgetMachine(record, env);
      note({ kind: "released", record });
    } catch (error) {
      note({ kind: "failed", record, error: (error as Error).message });
    }
  }
  return { gone: gone.length, outcomes, aborted: signal?.aborted === true };
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

/** True once `work` settles; false once `signal` aborts first. Rejects as `work` does. */
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
