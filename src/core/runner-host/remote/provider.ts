import type { AbsolutePath, EpochMs, WorktreeId } from "../../types/common.js";
import type { RemotePlaces } from "./bundle.js";
import type { SshTarget } from "./ssh.js";

/*
 * Spec 026 D6 (row 026-10): every remote lane reaches its machine through
 * this seam and never branches on a vendor name. A provider acquires a
 * machine for one worktree and brings it to an SSH-ready state; the lane
 * then speaks the runner-host protocol over `machine.ssh` as for any
 * static host (spec 021 Part 3). `wake`, `sleep` and `release` let a
 * provider stop compute while the lane is idle and free the machine when
 * the worktree is gone.
 */

export interface MachineCapabilities {
  /** True when the remote tree holds `.git` (lets 021 D19 `needsRepository` tests run remotely). */
  readonly hasGitRepository: boolean;
  /** True when closing idle SSH connections lets the provider stop compute billing or sleep the host. */
  readonly sleepOnIdle: boolean;
  /** True when the host key may rotate across relocations or restarts (the provider supplies its own SSH args). */
  readonly ephemeralHostKey: boolean;
}

/** A static host: none of the capabilities (D7.1). */
export const STATIC_CAPABILITIES: MachineCapabilities = {
  hasGitRepository: false,
  sleepOnIdle: false,
  ephemeralHostKey: false,
};

export interface MachineRequest {
  /** The key of the repository's entry in `remote.json`: its root path or one of its remote URLs. */
  readonly repositoryKey: string;
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly remoteUrls: readonly string[];
  /** Local Node version string (e.g. `v26.13.0`), used by providers that provision Node. */
  readonly nodeVersion: string;
  readonly log: (line: string) => void;
  /** The env a provider's own processes (hooks, `ssh`) run with. Default the daemon's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** Why a machine is released: `idle` sleeps, `daemon-exit` sleeps or detaches, `worktree-removed` destroys. */
export type ReleaseReason = "idle" | "daemon-exit" | "worktree-removed";

export interface RemoteMachine {
  /** Stable display id for status and logs, e.g. `build-box`, `agent37:eu:vm:c0myhlo00m`, `cmd:lan-1`. */
  readonly id: string;
  readonly provider: string;
  readonly ssh: SshTarget;
  readonly places: RemotePlaces;
  readonly capabilities: MachineCapabilities;
  /** The provider's own state for this machine, kept in `remote-machines.json` (JSON). */
  readonly state?: unknown;
  /** Ensures the machine is awake and SSH-reachable before opening a runner-host channel. */
  wake(signal?: AbortSignal): Promise<void>;
  /** Notifies the provider after the daemon closes idle SSH channels so compute may sleep. */
  sleep(): Promise<void>;
  /** Lifecycle release: `idle` sleeps, `daemon-exit` sleeps or detaches, `worktree-removed` destroys. */
  release(reason: ReleaseReason): Promise<void>;
}

/** Where a tracked machine stands, as `squeal remote list` shows it (D12). */
export type MachineStatus = "awake" | "sleeping" | "detached";

/**
 * One machine in `$XDG_STATE_HOME/squeal/remote-machines.json`: what a
 * provider needs to reach it again without acquiring (`reattach`), so
 * `squeal remote sleep` and `prune` work with no daemon running.
 */
export interface MachineRecord {
  readonly provider: string;
  readonly id: string;
  readonly worktreeId: WorktreeId;
  readonly worktreeRoot: AbsolutePath;
  readonly repositoryKey: string;
  readonly destination: string;
  readonly sshArgs: readonly string[];
  readonly places: RemotePlaces;
  readonly capabilities: MachineCapabilities;
  readonly state?: unknown;
  readonly status: MachineStatus;
  readonly createdAt: EpochMs;
  readonly lastUsedAt: EpochMs;
}

export interface RemoteMachineProvider {
  readonly kind: string;
  /** Validates provider-specific config under 001 D11 loader rules; returns problem text or `null`. */
  validate(config: Readonly<Record<string, unknown>>): string | null;
  /** Acquires or reuses a machine for one worktree and brings it to an SSH-ready state. */
  acquire(
    request: MachineRequest,
    config: Readonly<Record<string, unknown>>,
  ): Promise<RemoteMachine>;
  /**
   * The machine `record` names, reached again without acquiring: for
   * `squeal remote sleep` and `prune`, which run without a daemon (D12).
   */
  reattach(
    record: MachineRecord,
    config: Readonly<Record<string, unknown>>,
    env?: NodeJS.ProcessEnv,
  ): RemoteMachine;
}

/** The record of `machine`, acquired for `request`, at `now`. */
export function recordOf(
  machine: RemoteMachine,
  request: Pick<MachineRequest, "worktreeId" | "worktreeRoot" | "repositoryKey">,
  now: EpochMs,
): MachineRecord {
  return {
    provider: machine.provider,
    id: machine.id,
    worktreeId: request.worktreeId,
    worktreeRoot: request.worktreeRoot,
    repositoryKey: request.repositoryKey,
    destination: machine.ssh.destination,
    sshArgs: machine.ssh.args ?? [],
    places: machine.places,
    capabilities: machine.capabilities,
    ...(machine.state === undefined ? {} : { state: machine.state }),
    status: "awake",
    createdAt: now,
    lastUsedAt: now,
  };
}
