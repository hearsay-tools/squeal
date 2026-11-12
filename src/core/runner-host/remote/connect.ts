import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AbsolutePath } from "../../types/common.js";
import type { RunnerAdapter, RunReport } from "../../types/runner.js";
import { channelOf, type HostChannel, type RunnerHostLaunch } from "../channel.js";
import type { HostAdapterOptions, HostPolicy, HostRunner } from "../protocol.js";
import { type HostDeadlines, type HostRequests, startHostProxy } from "../proxy.js";
import type { AdmitAnswer, AdmitAsk } from "./admission.js";
import { bundleDir, ensureBundle, type RemotePlaces, readBundle } from "./bundle.js";
import { type SshTarget, shellQuote, spawnSsh } from "./ssh.js";
import { treeEntries, treePaths, writesFor } from "./tree.js";
import { LOCKFILES } from "./tree-install.js";
import {
  type HostCore,
  type InstallAnswer,
  insideRoot,
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
 */

/** How long each remote step may take beyond the host's own deadlines. */
export interface RemoteDeadlines {
  /** Checking or copying the bundle: one `ssh` each. */
  readonly sshMs: number;
  /** An install from the lockfile. */
  readonly installMs: number;
}

export const REMOTE_DEADLINES: RemoteDeadlines = { sshMs: 120_000, installMs: 1_800_000 };

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
}

export interface RemoteHostOptions {
  readonly target: SshTarget;
  readonly places: RemotePlaces;
  /** The daemon's launch: its CLI names the bundle that is copied. */
  readonly launch: RunnerHostLaunch;
  readonly version: string;
  /** The local worktree's root. */
  readonly root: AbsolutePath;
  readonly runner: HostRunner;
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
  readonly note?: (text: string) => void;
  readonly optimizer?: (projects: readonly string[]) => void;
  /** One line per step of the first connect, for the daemon's log. */
  readonly log?: (text: string) => void;
  readonly deadlines?: Partial<HostDeadlines & RemoteDeadlines>;
}

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
  const tree = treeDir(places, root);
  const command = hostCommand(places, options.version, bundle.cli, tree, options.runner);
  return remoteHostOver(channelOf(spawnSsh(target, command)), ensured.check.node, options);
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
  const { coverage: _off, ...adapterOptions } = options.options;
  const adapter = await startHostProxy({
    channel,
    runner: options.runner,
    version: options.version,
    // Spec 021 D12: coverage stays off on a remote lane.
    options: adapterOptions,
    policy: () => ({ ...options.policy(), coverage: false, coverageChildren: false }),
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
      await install(on);
    },
    invalidateWith: async (paths) => {
      const on = requests;
      const changed = paths.filter((p) => p.kind !== "touch").map((p) => p.path);
      if (on === null || changed.length === 0) return undefined;
      const writes = await writesFor(root, changed, new Set(await treePaths(root)));
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
    adapter: withLogs(adapter),
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

/** `adapter` whose runs' reports carry their logs: written into the run's own `logDir`. */
function withLogs(adapter: RunnerAdapter): RunnerAdapter {
  const run = adapter.run.bind(adapter);
  adapter.run = async (testFiles, options) => {
    const report = (await run(testFiles, options)) as RunReport & RemoteRunReply;
    const { logs, ...rest } = report;
    // `refused` and `proof` stay: the lane reads them (spec 021 D11).
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
