import type { VitestAdapterOptions } from "../../../runners/vitest/index.js";
import { withSlowInstance } from "../../daemon/slow-instance.js";
import { repositoryRootOf } from "../../daemon/user-config.js";
import { worktreeIdOfRealPath } from "../../fs/git-layout.js";
import { runnerKeyingDeferred } from "../../scheduler/deferred-keying.js";
import type { AbsolutePath } from "../../types/common.js";
import type { RemoteSleepOutcome } from "../../types/daemon.js";
import type { Policy } from "../../types/policy.js";
import { BESIDE_LANE_PREFIX, isSlowLane, type RunnerAdapter } from "../../types/runner.js";
import type { RunnerHostLaunch } from "../channel.js";
import type { HostAdapterOptions, HostPolicy } from "../protocol.js";
import { hostedOptions } from "../vitest-host.js";
import { startRemoteHost } from "./connect.js";
import { withRemoteLane } from "./lane.js";
import { tiersText } from "./lane-tiers.js";
import { MachineEnding, type MachineShare, shareMachine } from "./machine-share.js";
import {
  laneLabel,
  loadRemoteSettings,
  type RemoteLane,
  type RemoteRunner,
  type RemoteTier,
  remoteLaneFor,
  remoteUrls,
  settingsNote,
} from "./settings.js";

/*
 * Spec 021 D9, D12, D17 (rows 021-13, 021-14): the daemon's runners with
 * their remote tiers on the remote the user names for this repository,
 * when the repository allows it. Status names each lane in a note topic:
 * its target, its last proof or refusal, an unreachable target, or why no
 * lane is used. Spec 021 D19 (row 021-23): the policy's `requires.commands`
 * are looked for on the remote at each connect, its `remote.needsRepository`
 * files run here, and a second topic names the files a remote failed as
 * not a Git repository.
 *
 * Spec 026 D6, D7 (row 026-10): the lanes reach their machine through the
 * entry's provider (`machine-share.ts`). A `{ target }` entry is the `ssh`
 * provider, whose machine is the target as before. S2 (spec 026 D1): a
 * runner whose keying is deferred reaches its machine at its first remote
 * run, not at the daemon's start.
 *
 * Spec 026 D8 (row 026-11): every runner the entry's `runners` names, Vitest
 * and each node:test and pytest project, gets a lane over one shared
 * machine, which sends the tiers its `lanes` names. A slow or group lane's
 * Vitest instance, and a tier beside a named wait's batch, gets a lane of
 * its own per pass: its own remote host on the same machine and tree. The
 * runner's own lane keeps the topic `remote-lane`; each other's is
 * `remote-lane:<runner> <name>`. `sleepRemote` and the idle sleep take
 * every lane (`MachineShare.sleep`); the daemon's exit releases the machine
 * once, after every runner closed (`withRemoteRelease`).
 *
 * Review 0.1.617 B1: a lane's connect is the machine's `serial` work under
 * the lane's close signal. A host that started after its lane closed or the
 * daemon's exit began is closed before the work ends, so the exit, which
 * waits for every such work, finds no host open when it releases the machine.
 *
 * Spec 026 D8.3, D8.4 (row 026-12): each lane plans where the entry's
 * `planning` says; once the daemon's exit began, no planning call falls back
 * here. A machine whose tree is a Git repository takes `needsRepository`
 * files too; review 0.1.619 B3: only while its `.git` is at the worktree's
 * Git state, which the lane refreshes before each split (`refreshGit`).
 */

/** The note topic of the runner's own lane's one status line. */
export const REMOTE_TOPIC = "remote-lane";
/** The note topic of `remote.json`'s problems. */
export const REMOTE_SETTINGS_TOPIC = "remote-settings";
/** The note topic of the files a remote failed as not a Git repository (D19.2). */
export const REMOTE_REPOSITORY_TOPIC = "remote-lane:repository";

export interface DaemonRemoteOptions {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly version: string;
  /** The daemon's own launch: its CLI names the bundle a remote gets. */
  readonly launch: RunnerHostLaunch | undefined;
  readonly policy: () => Policy;
  readonly note: (text: string, topic: string) => void;
  /** The newest note of `topic`, so an unchanged one is not written again. */
  readonly lastNote: (topic: string) => string | undefined;
  readonly log: (text: string) => void;
  readonly env?: NodeJS.ProcessEnv;
  /** Starts a remote host on the machine; absent, `startRemoteHost`. For tests. */
  readonly startHost?: typeof startRemoteHost;
}

export interface DaemonLaneOptions extends DaemonRemoteOptions {
  /** The Vitest runner as it runs here. */
  readonly vitest: RunnerAdapter;
  /** The options a Vitest instance of the runner's own lane takes. */
  readonly vitestOptions: VitestAdapterOptions;
}

/** What a remote host of one runner starts with: its adapter's data and policy (`startRemoteHost`). */
export interface RemoteStart {
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
  readonly note?: (text: string, topic?: string) => void;
}

/** One runner's lane on the shared machine. */
export interface LaneSpec<R extends RunnerAdapter> {
  readonly runner: RemoteRunner;
  /** Its name in its status topic, as `vitest slow:vitest` or `node-test unit`; absent: the runner's own lane. */
  readonly name?: string;
  /** Its planning, and the runs that stay here unless `here` is given. */
  readonly local: R;
  /** The runs that stay here, a slow lane's own instance (`RemoteLaneOptions.here`). */
  readonly here?: RunnerAdapter;
  /** Of the entry's tiers, those this lane may send; absent: all of them. */
  readonly tiers?: readonly RemoteTier[];
  /** Made per pass: it connects at its first remote run, and waits for the connect while the machine is awake. */
  readonly perPass?: boolean;
  readonly start: RemoteStart;
}

/** The repository's remote: its runners' lanes over one machine. */
export interface DaemonRemote {
  readonly lane: RemoteLane;
  /**
   * `spec.local` with its tiers on the shared machine, when the entry names
   * its runner and one of its tiers; else `spec.local` itself (or `here`).
   * The result has `local`'s members, `here`'s own when given.
   */
  wrap<R extends RunnerAdapter>(spec: LaneSpec<R>): R;
  sleepRemote(): Promise<RemoteSleepOutcome>;
  /** The daemon's exit, after every lane closed: the machine released once. */
  release(): Promise<void>;
}

/** The daemon's remote lane's sleep (B7), as `squeal remote sleep` reaches it. */
export interface DaemonRemoteLane {
  sleepRemote(): Promise<RemoteSleepOutcome>;
}

/** Whether `adapter` is a remote lane that can put its machine to sleep. */
export function sleepsRemote(adapter: RunnerAdapter): adapter is RunnerAdapter & DaemonRemoteLane {
  return typeof (adapter as Partial<DaemonRemoteLane>).sleepRemote === "function";
}

/** `adapter` when it is a remote lane that can put its machine to sleep; else `null`. */
export function remoteLaneOf(adapter: RunnerAdapter | null): DaemonRemoteLane | null {
  return adapter !== null && sleepsRemote(adapter) ? adapter : null;
}

/**
 * The repository's remote when `remote.json` names one and it may be used;
 * else `null`, with a note that says why every run is here.
 */
export function createDaemonRemote(options: DaemonRemoteOptions): DaemonRemote | null {
  const { root, commonDir, launch } = options;
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
    return null;
  }
  const { lane } = found;
  const target = laneLabel(lane);
  if (!options.policy().remote.allowed) {
    say(
      `remote ${target} not used: this repository's squeal.config.json forbids remote lanes (remote.allowed: false); every run is here`,
    );
    return null;
  }
  if (launch === undefined) {
    say(`remote ${target} not used: this daemon starts no runner hosts; every run is here`);
    return null;
  }
  const meanwhile = lane.whenLost === "local" ? "run here" : "are not run";
  const eager = (runner: RemoteRunner) =>
    !runnerKeyingDeferred(options.policy(), runner === "node-test" ? "nodeTest" : runner);
  const runs = `${tiersText(lane.lanes)} runs of ${lane.runners.join(", ")}`;
  say(
    lane.runners.some(eager)
      ? `remote ${target}: connecting; ${runs} ${meanwhile} until it answers`
      : `remote ${target}: connects at the first ${runs.replace(" runs ", " run ")}`,
  );
  const share = shareMachine({
    lane,
    request: {
      repositoryKey: found.key,
      worktreeId: worktreeIdOfRealPath(root),
      worktreeRoot: root,
      commonDir,
      remoteUrls: remoteUrls(commonDir),
      nodeVersion: process.version,
      log: options.log,
    },
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return {
    lane,
    wrap: <R extends RunnerAdapter>(spec: LaneSpec<R>): R => {
      const tiers = lane.lanes.filter((tier) => spec.tiers?.includes(tier) ?? true);
      if (!lane.runners.includes(spec.runner) || tiers.length === 0) {
        return (spec.here ?? spec.local) as R;
      }
      const topic = spec.name === undefined ? REMOTE_TOPIC : `${REMOTE_TOPIC}:${spec.name}`;
      return laneOver(share, spec, tiers, {
        target,
        lane,
        eager: spec.perPass !== true && eager(spec.runner),
        status: (text) => say(text, topic),
        repository: (text) => say(`remote ${target}: ${text}`, REMOTE_REPOSITORY_TOPIC),
        options,
      });
    },
    sleepRemote: () => share.sleep(),
    release: () => share.release(),
  };
}

interface LaneContext {
  readonly target: string;
  readonly lane: RemoteLane;
  readonly eager: boolean;
  readonly status: (text: string) => void;
  readonly repository: (text: string) => void;
  readonly options: DaemonRemoteOptions;
}

/** `spec.local` on a remote lane over `share`'s machine, joined to its sleep until it closes. */
function laneOver<R extends RunnerAdapter>(
  share: MachineShare,
  spec: LaneSpec<R>,
  tiers: readonly RemoteTier[],
  context: LaneContext,
): R {
  const { options, target } = context;
  const { root, version } = options;
  const launch = options.launch as RunnerHostLaunch;
  const adapter = withRemoteLane({
    target,
    eager: context.eager,
    lanes: tiers,
    // A lane made per pass waits for its connect while the machine is known awake; while it is
    // asleep or lost, its first tier runs here as the connect goes on, not after a failing one.
    ...(spec.perPass === true && share.awake() ? { awaitConnect: true } : {}),
    whenLost: context.lane.whenLost,
    planning: context.lane.planning,
    hasGitRepository: () => share.gitCurrent(),
    refreshRepository: (signal) => share.refreshGit(signal),
    ending: () => share.ending(),
    root,
    version,
    local: spec.local,
    ...(spec.here === undefined ? {} : { here: spec.here }),
    // One host starts at a time on the machine: the first sends the tree and installs, and the
    // next finds both done, instead of two writing and installing in one tree at once.
    connect: (signal) =>
      share.serial(async () => {
        const gone = () => signal.aborted || share.ending();
        const { ssh, machine } = await share.reach();
        if (gone()) throw new MachineEnding("its lane closed");
        const host = await (options.startHost ?? startRemoteHost)({
          target: ssh,
          places: machine.places,
          launch,
          version,
          root,
          runner: spec.runner,
          options: spec.start.options,
          policy: spec.start.policy,
          ...(spec.start.note === undefined ? {} : { note: spec.start.note }),
          log: options.log,
          commands: options.policy().requires.commands,
        });
        if (!gone()) return host;
        await host.adapter.close().catch(() => {});
        throw new MachineEnding("its lane closed while its host started");
      }, signal),
    allowlist: () => options.policy().env.allowlist,
    needsRepository: () => options.policy().remote.needsRepository,
    repository: context.repository,
    status: context.status,
    log: options.log,
    activity: () => share.activity(),
    lost: () => share.lost(),
  });
  const leave = share.join(adapter);
  const close = adapter.close.bind(adapter);
  adapter.close = async () => {
    leave();
    await close();
  };
  return adapter as unknown as R;
}

/** `runner` whose `close` releases `remote`'s machine after every lane in it closed (D8). */
export function withRemoteRelease(
  runner: RunnerAdapter,
  remote: DaemonRemote | null,
): RunnerAdapter {
  if (remote === null) return runner;
  const close = runner.close.bind(runner);
  runner.close = async () => {
    try {
      await close();
    } finally {
      await remote.release();
    }
  };
  return runner;
}

/** The daemon's Vitest instances (`withSlowInstance`) and what a remote host of each lane starts with. */
export interface VitestLanes {
  /** The instance of the runner's own lane, which plans for every lane. */
  readonly fast: RunnerAdapter;
  /** A slow or group lane's own instance, made per pass. */
  readonly lane: (lane: string) => RunnerAdapter;
  /** The instance of a tier beside a named wait's batch. */
  readonly beside: () => RunnerAdapter;
  readonly start: (lane: string) => RemoteStart;
}

/**
 * The daemon's Vitest runner (D8.1): `withSlowInstance` over the runner's
 * own lane, sending its edit and background tiers, and over each slow or
 * group lane and the tier beside a named wait's batch, each with a lane of
 * its own per pass when its tier goes remote: a remote host on the shared
 * machine, which closes when the pass ends.
 */
export function vitestOver(remote: DaemonRemote | null, lanes: VitestLanes): RunnerAdapter {
  const { fast } = lanes;
  if (remote === null) return withSlowInstance(fast, lanes.lane, lanes.beside);
  return withSlowInstance(
    remote.wrap({
      runner: "vitest",
      local: fast,
      tiers: ["edit", "background"],
      start: lanes.start("vitest"),
    }),
    (lane) =>
      remote.wrap({
        runner: "vitest",
        name: `vitest ${lane}`,
        local: fast,
        here: lanes.lane(lane),
        tiers: [isSlowLane(lane) ? "slow" : "group"],
        perPass: true,
        start: lanes.start(lane),
      }),
    () =>
      remote.wrap({
        runner: "vitest",
        name: "vitest beside",
        local: fast,
        here: lanes.beside(),
        tiers: ["edit"],
        perPass: true,
        start: lanes.start(`${BESIDE_LANE_PREFIX}${fast.name}`),
      }),
  );
}

/** What a remote Vitest host of an instance built from `options` starts with (D8.1). */
export function vitestRemoteStart(options: VitestAdapterOptions): RemoteStart {
  const { note } = options;
  return {
    ...hostedOptions(options),
    ...(note === undefined ? {} : { note: (text) => note(text) }),
  };
}

/**
 * `options.vitest`, its remote tiers on the remote lane when one is named
 * and allowed, which can put its machine to sleep (B7) and releases it at
 * its close: the lane of one runner over its own machine (rows 021-14, 026-10).
 */
export function withDaemonRemoteLane(options: DaemonLaneOptions): RunnerAdapter {
  const remote = createDaemonRemote(options);
  if (remote === null) return options.vitest;
  const adapter: RunnerAdapter & Partial<DaemonRemoteLane> = remote.wrap({
    runner: "vitest",
    local: options.vitest,
    start: vitestRemoteStart(options.vitestOptions),
  });
  if (adapter === options.vitest) return adapter;
  adapter.sleepRemote = () => remote.sleepRemote();
  return withRemoteRelease(adapter, remote);
}
