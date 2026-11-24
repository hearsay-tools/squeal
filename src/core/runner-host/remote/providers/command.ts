import { isRecord } from "../../../fs/json.js";
import type {
  MachineCapabilities,
  MachineRecord,
  ReleaseReason,
  RemoteMachine,
  RemoteMachineProvider,
} from "../provider.js";
import { validTarget } from "../ssh.js";
import { argumentList, placesProblem, plainString, unknownKey } from "./config.js";
import { runHook } from "./hook.js";

/*
 * Spec 026 D7.2 (row 026-10): the user's own scripts provision, wake, sleep
 * and release a machine: a LAN box behind Wake-on-LAN, a local VM, a
 * Tailscale host or any CLI. `acquire` prints one JSON line naming the
 * machine; the other hooks get its id and state in their env. The config
 * lives only in the user's `remote.json`, never in a repository.
 */

const HOOKS = ["acquire", "wake", "sleep", "release"] as const;
type Hook = (typeof HOOKS)[number];

const KEYS = [...HOOKS, "timeoutMs", "node", "cache"] as const;

/** Each hook's deadline when `timeoutMs` names none. */
export const HOOK_TIMEOUT_MS: Readonly<Record<Hook, number>> = {
  acquire: 120_000,
  wake: 120_000,
  sleep: 30_000,
  release: 30_000,
};

/** The prefix of a `command` machine's display id. */
const ID_PREFIX = "cmd:";

function validate(config: Readonly<Record<string, unknown>>): string | null {
  const unknown = unknownKey(config, KEYS);
  if (unknown !== null) return unknown;
  if (!argumentList(config.acquire, true)) {
    return '"acquire" must be a non-empty argument list such as ["~/bin/lan-up"]';
  }
  for (const hook of ["wake", "sleep", "release"] as const) {
    if (config[hook] !== undefined && !argumentList(config[hook], true)) {
      return `"${hook}" must be a non-empty argument list`;
    }
  }
  const timeout = config.timeoutMs;
  if (timeout !== undefined && !(typeof timeout === "number" && timeout > 0)) {
    return '"timeoutMs" must be a positive number';
  }
  return placesProblem(config);
}

/** What `acquire` printed: the machine as the provider names it. */
interface Acquired {
  readonly id: string;
  readonly destination: string;
  readonly sshArgs: readonly string[];
  readonly node?: string;
  readonly cache?: string;
  readonly capabilities: MachineCapabilities;
  readonly state?: unknown;
}

/** The last non-empty line of `stdout` as `acquire`'s answer; throws naming what is wrong. */
export function parseAcquired(stdout: string): Acquired {
  const line = stdout.trim().split("\n").at(-1)?.trim() ?? "";
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`the acquire hook printed no JSON line: ${JSON.stringify(line.slice(0, 200))}`);
  }
  const bad = (why: string) => new Error(`the acquire hook's answer ${why}`);
  if (!isRecord(value) || value.v !== 1) throw bad('must be an object with "v": 1');
  if (!plainString(value.id) || value.id === "") throw bad('needs "id", a non-empty string');
  if (!validTarget(value.destination)) throw bad('needs "destination", an SSH destination');
  if (value.sshArgs !== undefined && !argumentList(value.sshArgs, false)) {
    throw bad('has "sshArgs" that is not an array of strings');
  }
  for (const key of ["node", "cache"] as const) {
    const place = value[key];
    if (place !== undefined && (!plainString(place) || place === "")) {
      throw bad(`has "${key}" that is not a non-empty string`);
    }
  }
  const flag = (key: keyof MachineCapabilities): boolean => {
    const set = value[key];
    if (set !== undefined && typeof set !== "boolean")
      throw bad(`has "${key}" that is not a boolean`);
    return set === true;
  };
  return {
    id: value.id,
    destination: value.destination,
    sshArgs: (value.sshArgs as readonly string[] | undefined) ?? [],
    ...(value.node === undefined ? {} : { node: value.node as string }),
    ...(value.cache === undefined ? {} : { cache: value.cache as string }),
    capabilities: {
      hasGitRepository: flag("hasGitRepository"),
      sleepOnIdle: flag("sleepOnIdle"),
      ephemeralHostKey: flag("ephemeralHostKey"),
    },
    ...(value.state === undefined ? {} : { state: value.state }),
  };
}

/** Who the hooks run for: the worktree, as `SQUEAL_*` variables. */
interface HookContext {
  readonly worktreeId: string;
  readonly worktreeRoot: string;
  readonly repositoryKey: string;
  readonly nodeVersion: string;
  readonly env: NodeJS.ProcessEnv;
}

function hookEnv(context: HookContext, more: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...context.env,
    SQUEAL_WORKTREE_ID: context.worktreeId,
    SQUEAL_WORKTREE_ROOT: context.worktreeRoot,
    SQUEAL_REPO_KEY: context.repositoryKey,
    SQUEAL_NODE_VERSION: context.nodeVersion,
    ...more,
  };
}

function timeoutOf(config: Readonly<Record<string, unknown>>, hook: Hook): number {
  return typeof config.timeoutMs === "number" ? config.timeoutMs : HOOK_TIMEOUT_MS[hook];
}

/** The machine `acquired` names, its other hooks run from `config`. */
function commandMachine(
  context: HookContext,
  acquired: Acquired,
  config: Readonly<Record<string, unknown>>,
): RemoteMachine {
  const machineEnv = (more: Record<string, string> = {}) =>
    hookEnv(context, {
      SQUEAL_MACHINE_ID: acquired.id,
      SQUEAL_MACHINE_STATE: JSON.stringify(acquired.state ?? null),
      ...more,
    });
  const call = async (
    hook: Exclude<Hook, "acquire">,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) => {
    const argv = config[hook] as readonly string[] | undefined;
    if (argv === undefined) return;
    await runHook({
      name: hook,
      argv,
      env,
      timeoutMs: timeoutOf(config, hook),
      ...(signal === undefined ? {} : { signal }),
    });
  };
  return {
    id: `${ID_PREFIX}${acquired.id}`,
    provider: "command",
    ssh: {
      destination: acquired.destination,
      ...(acquired.sshArgs.length === 0 ? {} : { args: acquired.sshArgs }),
      env: context.env,
    },
    places: {
      node: acquired.node ?? (config.node as string),
      cache: acquired.cache ?? (config.cache as string),
    },
    capabilities: acquired.capabilities,
    ...(acquired.state === undefined ? {} : { state: acquired.state }),
    wake: (signal) => call("wake", machineEnv(), signal),
    sleep: () => call("sleep", machineEnv()),
    release: (reason: ReleaseReason) =>
      call("release", machineEnv({ SQUEAL_RELEASE_REASON: reason })),
  };
}

export const commandProvider: RemoteMachineProvider = {
  kind: "command",
  validate,
  acquire: async (request, config) => {
    const context: HookContext = { ...request, env: request.env ?? process.env };
    const stdout = await runHook({
      name: "acquire",
      argv: config.acquire as readonly string[],
      env: hookEnv(context),
      timeoutMs: timeoutOf(config, "acquire"),
    });
    const acquired = parseAcquired(stdout);
    request.log(`remote machine ${ID_PREFIX}${acquired.id} acquired at ${acquired.destination}`);
    return commandMachine(context, acquired, config);
  },
  reattach: (record: MachineRecord, config, env) =>
    commandMachine(
      {
        worktreeId: record.worktreeId,
        worktreeRoot: record.worktreeRoot,
        repositoryKey: record.repositoryKey,
        nodeVersion: process.version,
        env: env ?? process.env,
      },
      {
        id: record.id.startsWith(ID_PREFIX) ? record.id.slice(ID_PREFIX.length) : record.id,
        destination: record.destination,
        sshArgs: record.sshArgs,
        node: record.places.node,
        cache: record.places.cache,
        capabilities: record.capabilities,
        ...(record.state === undefined ? {} : { state: record.state }),
      },
      config,
    ),
};
