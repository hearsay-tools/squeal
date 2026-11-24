import { treeDir } from "../../connect.js";
import { readMachines } from "../../machines-store.js";
import type {
  MachineRecord,
  MachineRequest,
  RemoteMachine,
  RemoteMachineProvider,
} from "../../provider.js";
import { type SshTarget, shellQuote } from "../../ssh.js";
import { BOOTSTRAP_DEADLINES, ensureGitTree, ensureNode } from "./bootstrap.js";
import {
  AGENT37_DEFAULTS,
  type Agent37Settings,
  agent37Settings,
  validateAgent37,
} from "./config.js";
import {
  AGENT37,
  type Agent37State,
  type Agent37Timing,
  agent37Machine,
  apiOf,
  type GitKeeper,
  type GitPlace,
  gitKeeper,
  stateOf,
  untilRunning,
  unusable,
} from "./machine.js";
import { tunnelHost, validInstanceId } from "./tunnel.js";

/*
 * Spec 026 D7.3 (row 026-15): one Agent37 instance per worktree, EU `vm`
 * by default. `acquire` reuses the instance `remote-machines.json` tracks
 * for the worktree while Agent37 still has it (waking it), else creates
 * one, brings Node to the local version and, for `git-bundle`, sends the
 * worktree's history. SSH goes through `squeal remote-tunnel agent37`
 * (D7.3.2). `sleep` stops compute billing; `worktree-removed` deletes the
 * instance so its disk stops billing too.
 *
 * Row 026-20 (lessons O1): `request.signal` aborts `acquire` at the
 * daemon's exit. Before `POST /v1/instances` it creates none. The create in
 * flight is never cut: its answer carries the only id that can delete the
 * instance. A fresh instance whose create, start or bootstrap ended after
 * the abort is deleted at once, before `acquire` rejects.
 */

/** `acquire` stopped because the daemon's exit began (`MachineRequest.signal`). */
export class AcquireAborted extends Error {
  constructor() {
    super("Agent37 acquire stopped: the daemon's exit began");
  }
}

/** The login on the instance: the base image's user, whose home is the instance's disk. */
const SSH_USER = "node";

const TIMING: Agent37Timing = {
  pollMs: 2_000,
  readyMs: 300_000,
  bootstrap: BOOTSTRAP_DEADLINES,
  cli: [process.execPath, "--disable-warning=ExperimentalWarning", process.argv[1] ?? ""],
};

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
  const { signal } = request;
  const stop = () => {
    if (signal?.aborted === true) throw new AcquireAborted();
  };
  const api = apiOf(settings, env, timing);
  const tracked = trackedState(request, env);
  let state: Agent37State | null = null;
  stop();
  if (tracked !== null) {
    const found = await api.inspect(tracked.instanceId);
    stop();
    if (found === null) {
      request.log(`Agent37 instance ${tracked.instanceId} is gone; creating another`);
    } else {
      // A tracked instance stays tracked: an abort leaves it to the record and `remote prune`.
      await untilRunning(api, tracked.instanceId, found, timing, signal);
      state = tracked;
      request.log(`Agent37 instance ${tracked.instanceId} reused (${found.status} before)`);
    }
  }
  const created = state === null;
  if (state === null) {
    stop();
    // Never aborted in flight: an instance Agent37 made after a cut request has no id here to delete.
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
    if (signal?.aborted === true) {
      await api.remove(made.id).catch(() => {});
      request.log(`Agent37 instance ${made.id} created after the daemon's exit began; deleted`);
      throw new AcquireAborted();
    }
    state = {
      instanceId: made.id,
      region: settings.region,
      type: settings.type,
      bootstrap: settings.bootstrap,
    };
    request.log(`Agent37 instance ${made.id} created (${settings.region} ${settings.type})`);
    try {
      await untilRunning(api, made.id, made, timing, signal);
    } catch (error) {
      await api.remove(made.id).catch(() => {});
      throw error;
    }
  }
  try {
    stop();
    const machine = await bootstrap(request, settings, state, env, timing);
    if (created) stop();
    return machine;
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
  let keeper: GitKeeper | null = null;
  if (settings.bootstrap === "git-bundle") {
    // Review 0.1.619 B3: `.git` at the worktree's Git state, on a fresh instance and a reused one.
    const place = gitPlace(places, request.worktreeRoot, timing, request.log);
    const git = await ensureGitTree(ssh, place.tree, place.root, timing.bootstrap);
    if (git.kind === "sent")
      request.log(`Agent37 instance ${state.instanceId}: git history sent at ${git.commit}`);
    if (git.kind === "none")
      request.log(`Agent37 instance ${state.instanceId}: no git history (${git.why})`);
    keeper = gitKeeper(place, git.kind === "none" ? null : git.state);
  }
  return agent37Machine({
    settings,
    state,
    env,
    ssh,
    places,
    hasGitRepository: keeper !== null,
    git: keeper,
    timing,
  });
}

/** Where a machine's `.git` is kept: the tree of `root` under `places`. */
function gitPlace(
  places: RemoteMachine["places"],
  root: string,
  timing: Agent37Timing,
  log: (line: string) => void,
): GitPlace {
  return { tree: treeDir(places, root), root, deadlines: timing.bootstrap, log };
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
        // Found at no state yet: its first wake brings it current.
        git: record.capabilities.hasGitRepository
          ? gitKeeper(
              gitPlace(record.places, record.worktreeRoot, t, () => {}),
              null,
            )
          : null,
        timing: t,
      });
    },
  };
}

export const agent37Provider: RemoteMachineProvider = createAgent37Provider();
