import { isRecord } from "../../../../fs/json.js";
import { treeDir } from "../../connect.js";
import { readMachines } from "../../machines-store.js";
import type {
  MachineRecord,
  MachineRequest,
  ReleaseReason,
  RemoteMachine,
  RemoteMachineProvider,
} from "../../provider.js";
import { type SshTarget, shellQuote } from "../../ssh.js";
import { Agent37Api, type Instance } from "./api.js";
import {
  BOOTSTRAP_DEADLINES,
  type BootstrapDeadlines,
  ensureGitTree,
  ensureNode,
} from "./bootstrap.js";
import {
  AGENT37_DEFAULTS,
  type Agent37Settings,
  agent37Settings,
  validateAgent37,
} from "./config.js";
import { tunnelHost, validInstanceId } from "./tunnel.js";

/*
 * Spec 026 D7.3 (row 026-15): one Agent37 instance per worktree, EU `vm`
 * by default. `acquire` reuses the instance `remote-machines.json` tracks
 * for the worktree while Agent37 still has it (waking it), else creates
 * one, brings Node to the local version and, for `git-bundle`, sends the
 * worktree's history. SSH goes through `squeal remote-tunnel agent37`
 * (D7.3.2). `sleep` stops compute billing; `worktree-removed` deletes the
 * instance so its disk stops billing too.
 */

export const AGENT37 = "agent37";

/** The login on the instance: the base image's user, whose home is the instance's disk. */
const SSH_USER = "node";

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

const TIMING: Agent37Timing = {
  pollMs: 2_000,
  readyMs: 300_000,
  bootstrap: BOOTSTRAP_DEADLINES,
  cli: [process.execPath, "--disable-warning=ExperimentalWarning", process.argv[1] ?? ""],
};

function stateOf(value: unknown): Agent37State | null {
  if (!isRecord(value) || !validInstanceId(value.instanceId)) return null;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  return {
    instanceId: value.instanceId,
    region: text("region"),
    type: text("type"),
    bootstrap: text("bootstrap"),
  };
}

/** `word` for an ssh `ProxyCommand`: shell-quoted, `%` escaped from ssh's own tokens. */
function proxyWord(word: string): string {
  return shellQuote(word).replaceAll("%", "%%");
}

/** How SSH reaches instance `id`: through the tunnel subcommand, host keys not pinned. */
export function agent37Ssh(
  settings: Agent37Settings,
  id: string,
  env: NodeJS.ProcessEnv,
  cli: readonly string[],
): SshTarget {
  const tunnel = [...cli, "remote-tunnel", AGENT37, id];
  if (settings.apiKeyEnv !== AGENT37_DEFAULTS.apiKeyEnv)
    tunnel.push("--api-key-env", settings.apiKeyEnv);
  if (settings.tunnelHostTemplate !== AGENT37_DEFAULTS.tunnelHostTemplate) {
    tunnel.push("--host", tunnelHost(settings.tunnelHostTemplate, id));
  }
  return {
    destination: `${SSH_USER}@${id}.agent37.app`,
    args: [
      "-o",
      `ProxyCommand=${tunnel.map(proxyWord).join(" ")}`,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      ...(settings.sshKeyPath === undefined
        ? []
        : ["-i", settings.sshKeyPath, "-o", "IdentitiesOnly=yes"]),
    ],
    env,
  };
}

function apiOf(
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
async function untilRunning(
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

interface MachineParts {
  readonly settings: Agent37Settings;
  readonly state: Agent37State;
  readonly env: NodeJS.ProcessEnv;
  readonly ssh: SshTarget;
  readonly places: RemoteMachine["places"];
  readonly hasGitRepository: boolean;
  readonly timing: Agent37Timing;
}

function agent37Machine(parts: MachineParts): RemoteMachine {
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

/** The tracked instance of `request`'s worktree, when there is one. */
function trackedState(request: MachineRequest, env: NodeJS.ProcessEnv): Agent37State | null {
  const record = readMachines(env).machines.find(
    (m) => m.provider === AGENT37 && m.worktreeId === request.worktreeId,
  );
  return record === undefined ? null : stateOf(record.state);
}

async function acquire(
  request: MachineRequest,
  config: Readonly<Record<string, unknown>>,
  timing: Agent37Timing,
): Promise<RemoteMachine> {
  const settings = agent37Settings(config);
  const env = request.env ?? process.env;
  if (config.type === "default") {
    request.log(
      'Agent37 "default" (gVisor) runs tests 3 to 4 times slower than "vm" and stored false failures in research; prefer "vm"',
    );
  }
  const api = apiOf(settings, env, timing);
  const tracked = trackedState(request, env);
  let state: Agent37State | null = null;
  if (tracked !== null) {
    const found = await api.inspect(tracked.instanceId);
    if (found === null) {
      request.log(`Agent37 instance ${tracked.instanceId} is gone; creating another`);
    } else {
      await untilRunning(api, tracked.instanceId, found, timing);
      state = tracked;
      request.log(`Agent37 instance ${tracked.instanceId} reused (${found.status} before)`);
    }
  }
  const created = state === null;
  if (state === null) {
    const made = await api.create({
      template: "agent37-base",
      region: settings.region,
      type: settings.type,
      resources: { cpu: settings.vcpu, memory: settings.memoryGb, disk: settings.diskGb },
      auto_sleep: true,
      idle_timeout_seconds: settings.autoSleepMinutes * 60,
      name: `squeal-${request.worktreeId.slice(0, 12)}`,
    });
    if (!validInstanceId(made.id))
      throw new Error("Agent37 created an instance with an unusable id");
    state = {
      instanceId: made.id,
      region: settings.region,
      type: settings.type,
      bootstrap: settings.bootstrap,
    };
    request.log(`Agent37 instance ${made.id} created (${settings.region} ${settings.type})`);
    try {
      await untilRunning(api, made.id, made, timing);
    } catch (error) {
      await api.remove(made.id).catch(() => {});
      throw error;
    }
  }
  try {
    return await bootstrap(request, settings, state, env, timing);
  } catch (error) {
    // A fresh instance that never became usable holds nothing: deleted, so no disk bills untracked.
    if (created) await api.remove(state.instanceId).catch(() => {});
    throw error;
  }
}

async function bootstrap(
  request: MachineRequest,
  settings: Agent37Settings,
  state: Agent37State,
  env: NodeJS.ProcessEnv,
  timing: Agent37Timing,
): Promise<RemoteMachine> {
  const ssh = agent37Ssh(settings, state.instanceId, env, timing.cli);
  const node = await ensureNode(ssh, settings.node, request.nodeVersion, timing.bootstrap.nodeMs);
  const places = { node, cache: settings.cache };
  let hasGitRepository = false;
  if (settings.bootstrap === "git-bundle") {
    const tree = treeDir(places, request.worktreeRoot);
    const git = await ensureGitTree(ssh, tree, request.worktreeRoot, timing.bootstrap);
    hasGitRepository = git.kind !== "none";
    if (git.kind === "sent")
      request.log(`Agent37 instance ${state.instanceId}: git history sent at ${git.commit}`);
    if (git.kind === "none")
      request.log(`Agent37 instance ${state.instanceId}: no git history (${git.why})`);
  }
  return agent37Machine({ settings, state, env, ssh, places, hasGitRepository, timing });
}

/** A machine whose every call fails with `why`. */
function unusable(record: MachineRecord, why: string): RemoteMachine {
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

/** The `agent37` provider with `timing`; tests shorten the waits. */
export function createAgent37Provider(timing: Partial<Agent37Timing> = {}): RemoteMachineProvider {
  const t: Agent37Timing = { ...TIMING, ...timing };
  return {
    kind: AGENT37,
    validate: validateAgent37,
    acquire: (request, config) => acquire(request, config, t),
    reattach: (record: MachineRecord, config, env) => {
      const state = stateOf(record.state);
      // `squeal remote sleep` reattaches outside its error handling: never throw here.
      if (state === null)
        return unusable(record, `${record.id}: its record names no Agent37 instance`);
      return agent37Machine({
        settings: agent37Settings(config),
        state,
        env: env ?? process.env,
        ssh: {
          destination: record.destination,
          args: record.sshArgs,
          ...(env === undefined ? {} : { env }),
        },
        places: record.places,
        hasGitRepository: record.capabilities.hasGitRepository,
        timing: t,
      });
    },
  };
}

export const agent37Provider: RemoteMachineProvider = createAgent37Provider();
