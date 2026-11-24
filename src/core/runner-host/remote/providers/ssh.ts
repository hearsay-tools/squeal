import {
  type MachineRecord,
  type RemoteMachine,
  type RemoteMachineProvider,
  STATIC_CAPABILITIES,
} from "../provider.js";
import { validTarget } from "../ssh.js";
import { argumentList, placesProblem, unknownKey } from "./config.js";

/*
 * Spec 026 D7.1 (row 026-10): a static, always-on host the user names by
 * its SSH destination, as spec 021 Part 3 did: no capability, and `wake`,
 * `sleep` and `release` do nothing. Its config is the entry's `target`,
 * `node` and `cache`, and `args`: extra ssh flags before the destination.
 */

const KEYS = ["target", "args", "node", "cache"] as const;

function validate(config: Readonly<Record<string, unknown>>): string | null {
  const unknown = unknownKey(config, KEYS);
  if (unknown !== null) return unknown;
  if (!validTarget(config.target)) {
    return '"target" must be an SSH destination such as "build-box" or "me@host"';
  }
  if (config.args !== undefined && !argumentList(config.args, false)) {
    return '"args" must be an array of strings';
  }
  return placesProblem(config);
}

/** The machine at `destination`: nothing to wake, sleep or release. */
function staticMachine(
  destination: string,
  args: readonly string[],
  places: RemoteMachine["places"],
  env: NodeJS.ProcessEnv | undefined,
): RemoteMachine {
  return {
    id: destination,
    provider: "ssh",
    ssh: {
      destination,
      ...(args.length === 0 ? {} : { args }),
      ...(env === undefined ? {} : { env }),
    },
    places,
    capabilities: STATIC_CAPABILITIES,
    wake: async () => {},
    sleep: async () => {},
    release: async () => {},
  };
}

export const sshProvider: RemoteMachineProvider = {
  kind: "ssh",
  validate,
  acquire: async (request, config) =>
    staticMachine(
      config.target as string,
      (config.args as readonly string[] | undefined) ?? [],
      { node: config.node as string, cache: config.cache as string },
      request.env,
    ),
  reattach: (record: MachineRecord, _config, env) =>
    staticMachine(record.destination, record.sshArgs, record.places, env),
};
