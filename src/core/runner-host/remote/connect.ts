import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { MISSING_SCRIPT, missingText } from "../../daemon/required-commands.js";
import type { ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath } from "../../types/common.js";
import type { RunnerAdapter, RunReport } from "../../types/runner.js";
import { channelOf, type HostChannel, type RunnerHostLaunch } from "../channel.js";
import type { HostAdapterOptions, HostPolicy, HostRunner } from "../protocol.js";
import { type HostDeadlines, type HostRequests, startHostProxy } from "../proxy.js";
import type { AdmitAnswer, AdmitAsk } from "./admission.js";
import { bundleDir, ensureBundle, type RemotePlaces, readBundle } from "./bundle.js";
import { SETUP_MS, type SetupAnswer, setupRefusal } from "./remote-setup.js";
import type { RemoteRunner } from "./settings.js";
import { type SshTarget, shellQuote, spawnSsh, sshFailure, sshRun } from "./ssh.js";
import { treeEntries, treePathsFor, writesFor } from "./tree.js";
import { LOCKFILES } from "./tree-install.js";
import {
  HOST_PROVIDER,
  type HostCore,
  type InstallAnswer,
  insideRoot,
  type RemoteRunOptions,
  type RemoteRunReply,
  type TreeAnswer,
} from "./tree-wire.js";

/*
 * Spec 021 D9, D10, D14 (row 021-13): a runner host on a remote, started
 * through the user's `ssh`. First connect: the daemon's own bundle is copied
 * when the remote lacks it (D14); the host starts from it over the
 * worktree's tree, a directory of its own under the remote cache; the daemon
 * sends the files the host lacks, and the host installs from the lockfile
 * (D10). Then each revision's changed files ride on `invalidate`, and a run's
 * logs come back with its report.
 *
 * Spec 021 D19.1 (row 021-23): before the host starts, the commands the
 * project's tests need are looked for on the remote's `PATH`, which the
 * host's runs get; a missing one refuses the remote, named, before its tree
 * is sent.
 *
 * Spec 026 D8.2 (row 026-11): node:test's and pytest's temp and cache
 * directories are this machine's paths; a remote host gets directories of
 * its tree's own instead (`<tree>/tmp`, `<tree>/cache/<name>`), made before
 * it starts, so no local path reaches a remote process.
 *
 * Spec 026 D9 (row 026-13): under `coverage: "remote"` the host keeps
 * coverage on as the policy says: Vitest loads the provider of the host's
 * own bundle (`HOST_PROVIDER`) and writes payloads to `<tree>/tmp/coverage`;
 * each run asks for its records in the worktree's object format, and its
 * reply carries them to the lane, which keeps them only once the run is
 * proven. Under `"off"`, 021 D12 stands: coverage is stripped.
 *
 * Spec 026 D13.1 (row 026-35): with `setup`, the project's `remote.setup`,
 * the host runs that script of its tree once the tree has arrived and
 * before the install, unless the machine's mark says this content already
 * ran there. A failure refuses the remote with its exit code and the last
 * lines of its output. The script is in no key: it reaches the host here,
 * never through the policy or the environment.
 */

/** How long each remote step may take beyond the host's own deadlines. */
export interface RemoteDeadlines {
  /** Checking or copying the bundle: one `ssh` each. */
  readonly sshMs: number;
  /** An install from the lockfile. */
  readonly installMs: number;
  /** The `setup` request: the script's own bound, `SETUP_MS`, and a minute for the reply. */
  readonly setupMs: number;
}

export const REMOTE_DEADLINES: RemoteDeadlines = {
  sshMs: 120_000,
  installMs: 1_800_000,
  setupMs: SETUP_MS + 60_000,
};

/**
 * A remote host's own deadlines beside `HOST_DEADLINES` (spec 021 D13):
 * nothing but them notices a hung remote, so a run must show it is alive
 * every few seconds, and other calls answer within two minutes.
 */
export const REMOTE_HOST_DEADLINES: Partial<HostDeadlines> = { aliveMs: 30_000, callMs: 120_000 };

/** A started remote host: its adapter, and what the lane asks it beside. */
export interface RemoteHost {
  readonly adapter: RunnerAdapter;
  /** Its environment inputs, the variables of `allowlist` among them (spec 021 D11). */
  coreEnvironment(allowlist: readonly string[]): Promise<HostCore>;
  /** The blob id of each path in the host's tree; `null`: absent. */
  blobs(paths: readonly string[]): Promise<Readonly<Record<string, string | null>>>;
  /** One look at the remote machine's permit pool (spec 021 D18, row 021-21). */
  admit(ask: AdmitAsk): Promise<AdmitAnswer>;
  /**
   * The install from the lockfile, when the host's last one no longer
   * stands: another lockfile, or an install changed since (row 021-24).
   */
  install(): Promise<InstallAnswer>;
  /** Node on the remote, as the check before the start saw it. */
  readonly node: string;
  /**
   * Row 026-27: `git --version` on the remote, as the same check saw it;
   * `null`: no Git there; absent: not reported (a host over a test channel).
   */
  readonly gitVersion?: string | null;
}

export interface RemoteHostOptions {
  readonly target: SshTarget;
  readonly places: RemotePlaces;
  /** The daemon's launch: its CLI names the bundle that is copied. */
  readonly launch: RunnerHostLaunch;
  readonly version: string;
  /** The local worktree's root. */
  readonly root: AbsolutePath;
  /** Spec 026 D6.4: a remote serves `REMOTE_RUNNERS` only (Jest since spec 028 D7.4). */
  readonly runner: RemoteRunner;
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
  readonly note?: (text: string) => void;
  readonly optimizer?: (projects: readonly string[]) => void;
  /** One line per step of the first connect, for the daemon's log. */
  readonly log?: (text: string) => void;
  readonly deadlines?: Partial<HostDeadlines & RemoteDeadlines>;
  /** Spec 021 D19.1: `requires.commands`, looked for on the remote at each connect. Absent: none. */
  readonly commands?: readonly string[];
  /** Spec 026 D13.1: `remote.setup`, the repository-relative script run before the install. Absent: none. */
  readonly setup?: string | null;
  /**
   * Spec 026 D11: the machine's disk check, after the Node check and before
   * the host starts; rejects to refuse the machine. Absent: none.
   */
  readonly diskCheck?: () => Promise<void>;
  /** Spec 026 D9: `"remote"` maps coverage on the host; absent or `"off"`, 021 D12 strips it. */
  readonly coverage?: "off" | "remote";
  /** Spec 026 D9: the worktree's object format, the blob ids of remote records. Absent: none asked for. */
  readonly coverageFormat?: ObjectFormat;
}

/** A connect the remote refuses, as for a missing command (D19.1): the lane names it a refusal, not a loss. */
export class RemoteRefusal extends Error {}

/** The remote directory of the worktree at `root` on this machine: one per local worktree. */
export function treeDir(places: RemotePlaces, root: AbsolutePath): string {
  const key = createHash("sha256").update(`${hostname()}\0${root}`).digest("hex").slice(0, 16);
  return `${places.cache}/squeal/trees/${key}`;
}

/** The remote command that runs the host from the copied bundle over the tree at `tree`. */
export function hostCommand(
  places: RemotePlaces,
  version: string,
  cli: string,
  tree: string,
  runner: HostRunner,
): string {
  return [
    "exec",
    shellQuote(places.node),
    "--disable-warning=ExperimentalWarning",
    shellQuote(`${bundleDir(places, version)}/${cli}`),
    "runner-host",
    shellQuote(`${tree}/root`),
    "--runner",
    runner,
    "--tree",
  ].join(" ");
}

/**
 * The adapter of a host on `options.target` over the worktree's tree; the
 * first connect copies what the remote lacks. Rejects with the step that
 * failed: no bundle to copy, ssh, the copy, the install, or the start.
 */
export async function startRemoteHost(options: RemoteHostOptions): Promise<RemoteHost> {
  const deadlines = { ...REMOTE_DEADLINES, ...options.deadlines };
  const log = options.log ?? (() => {});
  const { target, places, root } = options;
  const bundle = readBundle(options.launch.cli);
  if (bundle === null) {
    throw new Error(
      `a remote lane needs Squeal's bundle to copy; this daemon runs from ${options.launch.cli}`,
    );
  }
  const ensured = await ensureBundle({
    target,
    places,
    version: options.version,
    bundle,
    deadlineMs: deadlines.sshMs,
  });
  log(
    `${target.destination}: Node ${ensured.check.node}; Squeal ${options.version} ${ensured.copied ? "copied" : "present"}`,
  );
  await options.diskCheck?.();
  const missing = await missingThere(target, places, options.commands ?? [], deadlines.sshMs);
  if (missing.length > 0) throw new RemoteRefusal(missingText(missing, "there"));
  const tree = treeDir(places, root);
  const command = hostCommand(places, options.version, bundle.cli, tree, options.runner);
  const mapped = options.coverage === "remote" && options.options.coverage !== undefined;
  const adapterOptions =
    options.options.process === undefined && !mapped
      ? options.options
      : remoteAdapterOptions(
          options.options,
          await remoteTreeDir(target, tree, deadlines.sshMs),
          options.coverage,
        );
  const host = await remoteHostOver(channelOf(spawnSsh(target, command)), ensured.check.node, {
    ...options,
    options: adapterOptions,
  });
  const git = ensured.check.git;
  return git === undefined ? host : { ...host, gitVersion: git };
}

/**
 * Spec 026 D8.2: the remote tree directory `tree` as an absolute path
 * there, with its `tmp` and `cache` made. Throws when the remote cannot.
 */
export async function remoteTreeDir(
  target: SshTarget,
  tree: string,
  deadlineMs: number,
): Promise<string> {
  const q = shellQuote(tree);
  const made = await sshRun(target, `mkdir -p ${q}/tmp/coverage ${q}/cache && cd ${q} && pwd -P`, {
    deadlineMs,
  });
  const what = `could not make ${tree}/tmp and ${tree}/cache on ${target.destination}`;
  if (made.code !== 0) throw new Error(sshFailure(what, made));
  const dir = made.stdout.trim();
  if (!dir.startsWith("/")) throw new Error(`${what}: pwd printed ${JSON.stringify(dir)}`);
  return dir;
}

/**
 * `options` as a remote host over the tree at the absolute `tree` takes
 * them (D8.2): node:test's, pytest's and Jest's temp directory is
 * `<tree>/tmp`, pytest's and Jest's cache directory `<tree>/cache/<its last
 * name here>`. D9: under
 * `coverage: "remote"`, Vitest's provider is the host's own and its
 * payloads go to `<tree>/tmp/coverage`.
 */
export function remoteAdapterOptions(
  options: HostAdapterOptions,
  tree: string,
  coverage: "off" | "remote" = "off",
): HostAdapterOptions {
  const vitest =
    coverage === "remote" && options.coverage !== undefined
      ? { coverage: { provider: HOST_PROVIDER, tempDir: `${tree}/tmp/coverage` } }
      : {};
  const data = options.process;
  if (data === undefined) return "coverage" in vitest ? { ...options, ...vitest } : options;
  const { tempDir: _here, cacheDir, ...kept } = data;
  return {
    ...options,
    ...vitest,
    process: {
      ...kept,
      tempDir: `${tree}/tmp`,
      ...(cacheDir === undefined ? {} : { cacheDir: `${tree}/cache/${basename(cacheDir)}` }),
    },
  };
}

/** Spec 021 D12: `options` without coverage, Vitest's, node:test's and Jest's. */
function withoutCoverage(options: HostAdapterOptions): HostAdapterOptions {
  const { coverage: _off, process: data, ...rest } = options;
  if (data === undefined) return rest;
  const { coverage: _none, ...kept } = data;
  return { ...rest, process: kept };
}

/** Of `commands`, those the remote's `PATH` lacks, by `MISSING_SCRIPT` under its Node. Throws when it cannot look. */
export async function missingThere(
  target: SshTarget,
  places: RemotePlaces,
  commands: readonly string[],
  deadlineMs: number,
): Promise<string[]> {
  if (commands.length === 0) return [];
  const command = [places.node, "-e", MISSING_SCRIPT, ...commands].map(shellQuote).join(" ");
  const looked = await sshRun(target, command, { deadlineMs });
  const what = `could not look for ${commands.join(", ")} on ${target.destination}`;
  if (looked.code !== 0) throw new Error(sshFailure(what, looked));
  try {
    const missing: unknown = JSON.parse(looked.stdout);
    if (Array.isArray(missing) && missing.every((name) => commands.includes(name))) return missing;
  } catch {
    // Below.
  }
  throw new Error(`${what}: its Node printed ${JSON.stringify(looked.stdout.slice(0, 200))}`);
}

/**
 * The remote host on `channel`: its tree brought to the worktree's, its
 * install, its start; then each revision's files on `invalidate`. Exported
 * for tests, which serve a host in their own process.
 */
export async function remoteHostOver(
  channel: HostChannel,
  node: string,
  options: Omit<RemoteHostOptions, "places" | "launch">,
): Promise<RemoteHost> {
  const hostDeadlines = { ...REMOTE_HOST_DEADLINES, ...options.deadlines };
  const deadlines = { ...REMOTE_DEADLINES, ...hostDeadlines };
  const callMs = deadlines.callMs ?? 300_000;
  const log = options.log ?? (() => {});
  const { target, root } = options;
  let requests: HostRequests | null = null;
  const install = async (on: HostRequests): Promise<InstallAnswer> => {
    const done = (await on.request("install", [], deadlines.installMs)) as InstallAnswer;
    if (done.again === true) {
      log(
        `${target.destination}: installed again with ${done.command}: the install changed since it was made there`,
      );
    } else if (done.ran) log(`${target.destination}: installed with ${done.command}`);
    return done;
  };
  // D13.1: a failing script refuses the remote; its output goes to the daemon's log either way.
  const setup = async (on: HostRequests, path: string) => {
    const done = (await on.request("setup", [path], deadlines.setupMs)) as SetupAnswer;
    const output = done.output.trimEnd();
    if (done.ran || done.failed !== undefined) {
      const how = done.failed ?? "exit code 0";
      log(
        `${target.destination}: remote.setup ${path} ran (${how})${output === "" ? "" : `:\n${output}`}`,
      );
    }
    if (done.failed !== undefined)
      throw new RemoteRefusal(setupRefusal(path, target.destination, done));
  };
  // Spec 021 D12: coverage stays off on a remote lane, unless D9 maps it there.
  const mapped = options.coverage === "remote";
  const adapterOptions = mapped ? options.options : withoutCoverage(options.options);
  const adapter = await startHostProxy({
    channel,
    runner: options.runner,
    version: options.version,
    options: adapterOptions,
    policy: mapped
      ? options.policy
      : () => ({ ...options.policy(), coverage: false, coverageChildren: false }),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.optimizer === undefined ? {} : { optimizer: options.optimizer }),
    deadlines: hostDeadlines,
    prepare: async (on) => {
      requests = on;
      const entries = await treeEntries(root);
      const { missing } = (await on.request("tree", [entries], callMs)) as TreeAnswer;
      const paths = new Set(entries.map((entry) => entry.path));
      let bytes = 0;
      let wire = 0;
      for (const write of await writesFor(root, missing, paths)) {
        await on.request("write", [write], callMs);
        bytes += write.files.reduce((sum, file) => sum + file.size, 0);
        wire += write.gzip.length;
      }
      log(
        `${target.destination}: tree of ${entries.length} files, ${missing.length} sent (${mib(bytes)}, ${mib(wire)} on the wire)`,
      );
      if (options.setup != null) await setup(on, options.setup);
      await install(on);
    },
    invalidateWith: async (paths) => {
      const on = requests;
      const changed = paths.filter((p) => p.kind !== "touch").map((p) => p.path);
      if (on === null || changed.length === 0) return undefined;
      const writes = await writesFor(root, changed, await treePathsFor(root, changed));
      const lockfile = changed.some((path) =>
        (LOCKFILES as readonly string[]).includes(basename(path)),
      );
      if (writes.length === 1 && !lockfile) return writes[0];
      for (const write of writes) await on.request("write", [write], callMs);
      if (lockfile) await install(on);
      return undefined;
    },
  });
  const started = (): HostRequests => {
    if (requests === null) throw new Error("the remote host has not started");
    return requests;
  };
  return {
    adapter: withLogs(adapter, mapped ? options.coverageFormat : undefined),
    node,
    coreEnvironment: async (allowlist) =>
      (await started().request("coreEnvironment", [allowlist], callMs)) as HostCore,
    blobs: async (paths) =>
      (await started().request("blobs", [paths], callMs)) as Record<string, string | null>,
    admit: async (ask) => (await started().request("admit", [ask], callMs)) as AdmitAnswer,
    install: () => install(started()),
  };
}

/** `bytes` in MiB, one decimal. */
function mib(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

/**
 * `adapter` whose runs' reports carry their logs: written into the run's
 * own `logDir`. D9: with `coverageFormat`, each run asks for its records.
 */
function withLogs(adapter: RunnerAdapter, coverageFormat?: ObjectFormat): RunnerAdapter {
  const run = adapter.run.bind(adapter);
  const asked: RemoteRunOptions = coverageFormat === undefined ? {} : { coverageFormat };
  adapter.run = async (testFiles, options) => {
    const report = (await run(testFiles, { ...options, ...asked })) as RunReport & RemoteRunReply;
    const { logs, ...rest } = report;
    // `refused`, `proof` and `coverage` stay: the lane reads them (spec 021 D11, 026 D9).
    for (const log of logs ?? []) {
      if (!insideRoot(log.name)) continue;
      const at = join(options.logDir, log.name);
      await mkdir(dirname(at), { recursive: true }).catch(() => {});
      await writeFile(at, Buffer.from(log.data, "base64")).catch(() => {});
    }
    return rest;
  };
  return adapter;
}
