import type { VitestAdapterOptions } from "../../../runners/vitest/index.js";
import { repositoryRootOf } from "../../daemon/user-config.js";
import type { AbsolutePath } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { RunnerAdapter } from "../../types/runner.js";
import type { RunnerHostLaunch } from "../channel.js";
import { hostedOptions } from "../vitest-host.js";
import { startRemoteHost } from "./connect.js";
import { withRemoteLane } from "./lane.js";
import { loadRemoteSettings, remoteLaneFor, settingsNote } from "./settings.js";

/*
 * Spec 021 D9, D12, D17 (rows 021-13, 021-14): the daemon's Vitest runner
 * with its background runs on the remote the user names for this
 * repository, when the repository allows it. Status names the lane in one
 * note topic: its target, its last proof or refusal, an unreachable target,
 * or why no lane is used. Spec 021 D19 (row 021-23): the policy's
 * `requires.commands` are looked for on the remote at each connect, its
 * `remote.needsRepository` files run here, and a second topic names the
 * files a remote failed as not a Git repository.
 */

/** The note topic of the lane's one status line. */
export const REMOTE_TOPIC = "remote-lane";
/** The note topic of `remote.json`'s problems. */
export const REMOTE_SETTINGS_TOPIC = "remote-settings";
/** The note topic of the files a remote failed as not a Git repository (D19.2). */
export const REMOTE_REPOSITORY_TOPIC = "remote-lane:repository";

export interface DaemonLaneOptions {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly version: string;
  /** The daemon's own launch: its CLI names the bundle a remote gets. */
  readonly launch: RunnerHostLaunch | undefined;
  readonly policy: () => Policy;
  /** The Vitest runner as it runs here. */
  readonly vitest: RunnerAdapter;
  /** The options a Vitest instance of the runner's own lane takes. */
  readonly vitestOptions: VitestAdapterOptions;
  readonly note: (text: string, topic: string) => void;
  /** The newest note of `topic`, so an unchanged one is not written again. */
  readonly lastNote: (topic: string) => string | undefined;
  readonly log: (text: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}

/** `options.vitest`, its background runs on the remote lane when one is named and allowed. */
export function withDaemonRemoteLane(options: DaemonLaneOptions): RunnerAdapter {
  const { root, commonDir, version, launch } = options;
  const say = (text: string, topic = REMOTE_TOPIC) => {
    if (options.lastNote(topic) !== text) options.note(text, topic);
  };
  const settings = loadRemoteSettings(options.env);
  const problems = settingsNote(settings);
  if (problems !== null) say(problems, REMOTE_SETTINGS_TOPIC);
  const found = remoteLaneFor(settings, repositoryRootOf(root, commonDir), commonDir);
  if (found === null) {
    // A lane named before and removed since: its last line would stand.
    if (options.lastNote(REMOTE_TOPIC) !== undefined) say("no remote lane: every run is here");
    return options.vitest;
  }
  const { target } = found.lane;
  if (!options.policy().remote.allowed) {
    say(
      `remote ${target} not used: this repository's squeal.config.json forbids remote lanes (remote.allowed: false); every run is here`,
    );
    return options.vitest;
  }
  if (launch === undefined) {
    say(`remote ${target} not used: this daemon starts no runner hosts; every run is here`);
    return options.vitest;
  }
  const meanwhile = found.lane.whenLost === "local" ? "run here" : "are not run";
  say(`remote ${target}: connecting; background runs of vitest ${meanwhile} until it answers`);
  const hosted = hostedOptions(options.vitestOptions);
  return withRemoteLane({
    target,
    whenLost: found.lane.whenLost,
    root,
    version,
    local: options.vitest,
    connect: () =>
      startRemoteHost({
        target: { destination: target },
        places: { node: found.lane.node, cache: found.lane.cache },
        launch,
        version,
        root,
        runner: "vitest",
        options: hosted.options,
        policy: hosted.policy,
        ...(options.vitestOptions.note === undefined ? {} : { note: options.vitestOptions.note }),
        log: options.log,
        commands: options.policy().requires.commands,
      }),
    allowlist: () => options.policy().env.allowlist,
    needsRepository: () => options.policy().remote.needsRepository,
    repository: (text) => say(`remote ${target}: ${text}`, REMOTE_REPOSITORY_TOPIC),
    status: (text) => say(text),
    log: options.log,
  });
}
