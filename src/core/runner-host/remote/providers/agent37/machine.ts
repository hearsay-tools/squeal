import { isRecord } from "../../../../fs/json.js";
import type { MachineRecord, ReleaseReason, RemoteMachine } from "../../provider.js";
import type { SshTarget } from "../../ssh.js";
import { Agent37Api, type Instance } from "./api.js";
import type { BootstrapDeadlines } from "./bootstrap.js";
import type { Agent37Settings } from "./config.js";
import { validInstanceId } from "./tunnel.js";

/*
 * Spec 026 D7.3.4 (row 026-15): an Agent37 machine once acquired or
 * reattached: `wake` polls it to `running` through `POST /start`, `sleep`
 * stops compute billing, `worktree-removed` deletes it (`404`: already
 * gone). A lost instance is named, so the lane knows it was lost.
 */

export const AGENT37 = "agent37";

/** What `remote-machines.json` keeps of an Agent37 machine. */
export interface Agent37State {
  readonly instanceId: string;
  readonly region: string;
  readonly type: string;
  readonly bootstrap: string;
}

export interface Agent37Timing {
  /** Waits between status polls, and between `409 try_again` retries. */
  readonly pollMs: number;
  /** How long an instance may take to read `running` after a create or start. */
  readonly readyMs: number;
  readonly bootstrap: BootstrapDeadlines;
  /** The command that starts this Squeal's CLI: Node and its script. */
  readonly cli: readonly string[];
}

export function stateOf(value: unknown): Agent37State | null {
  if (!isRecord(value) || !validInstanceId(value.instanceId)) return null;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  return {
    instanceId: value.instanceId,
    region: text("region"),
    type: text("type"),
    bootstrap: text("bootstrap"),
  };
}

export function apiOf(
  settings: Agent37Settings,
  env: NodeJS.ProcessEnv,
  timing: Agent37Timing,
): Agent37Api {
  return new Agent37Api({
    baseUrl: settings.apiBaseUrl,
    keyEnv: settings.apiKeyEnv,
    env,
    retryMs: timing.pollMs,
  });
}

/** The instance `id`, gone or not: `null` when Agent37 no longer has it. */
function goneError(id: string): Error {
  return new Error(`Agent37 instance ${id} is gone (deleted, or not in this workspace)`);
}

/** Polls `id` until `running`, waking it first when it is not; throws when it is gone or not up in time. */
export async function untilRunning(
  api: Agent37Api,
  id: string,
  seen: Instance,
  timing: Agent37Timing,
  signal?: AbortSignal,
): Promise<void> {
  let status = seen.status;
  if (status === "running") return;
  if (status === "sleeping" || status === "stopped") status = (await api.start(id)).status;
  const deadline = Date.now() + timing.readyMs;
  while (status !== "running") {
    signal?.throwIfAborted();
    if (Date.now() > deadline) {
      throw new Error(`Agent37 instance ${id} is still ${status} after ${timing.readyMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollMs));
    const now = await api.inspect(id);
    if (now === null) throw goneError(id);
    status = now.status;
    if (status === "sleeping" || status === "stopped") status = (await api.start(id)).status;
  }
}

export interface MachineParts {
  readonly settings: Agent37Settings;
  readonly state: Agent37State;
  readonly env: NodeJS.ProcessEnv;
  readonly ssh: SshTarget;
  readonly places: RemoteMachine["places"];
  readonly hasGitRepository: boolean;
  readonly timing: Agent37Timing;
}

export function agent37Machine(parts: MachineParts): RemoteMachine {
  const { state, timing } = parts;
  const id = state.instanceId;
  const api = apiOf(parts.settings, parts.env, timing);
  const sleep = async () => {
    const found = await api.inspect(id);
    if (found === null) throw goneError(id);
    if (found.status !== "sleeping" && found.status !== "stopped") await api.sleep(id);
  };
  return {
    id: `${AGENT37}:${state.region}:${state.type}:${id}`,
    provider: AGENT37,
    ssh: parts.ssh,
    places: parts.places,
    capabilities: {
      hasGitRepository: parts.hasGitRepository,
      sleepOnIdle: true,
      ephemeralHostKey: true,
    },
    state,
    wake: async (signal) => {
      const found = await api.inspect(id);
      if (found === null) throw goneError(id);
      await untilRunning(api, id, found, timing, signal);
    },
    sleep,
    release: async (reason: ReleaseReason) => {
      if (reason === "worktree-removed") {
        await api.remove(id);
        return;
      }
      // Idle or the daemon's exit: asleep, kept for a fast wake. One already gone needs nothing.
      await sleep().catch((error: unknown) => {
        if ((error as Error).message !== goneError(id).message) throw error;
      });
    },
  };
}

/** A machine whose every call fails with `why`. */
export function unusable(record: MachineRecord, why: string): RemoteMachine {
  const fail = () => Promise.reject(new Error(why));
  return {
    id: record.id,
    provider: AGENT37,
    ssh: { destination: record.destination, args: record.sshArgs },
    places: record.places,
    capabilities: record.capabilities,
    wake: fail,
    sleep: fail,
    release: fail,
  };
}
