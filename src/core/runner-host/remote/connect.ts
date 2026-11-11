import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AbsolutePath } from "../../types/common.js";
import type { RunnerAdapter, RunReport } from "../../types/runner.js";
import { channelOf, type RunnerHostLaunch } from "../channel.js";
import type { HostAdapterOptions, HostPolicy, HostRunner } from "../protocol.js";
import { type HostDeadlines, type HostRequests, startHostProxy } from "../proxy.js";
import { bundleDir, ensureBundle, type RemotePlaces, readBundle } from "./bundle.js";
import { type SshTarget, shellQuote, spawnSsh } from "./ssh.js";
import { treeEntries, treePaths, writesFor } from "./tree.js";
import { LOCKFILES } from "./tree-host.js";
import { type InstallAnswer, insideRoot, type TreeAnswer, type WireLog } from "./tree-wire.js";

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
export async function startRemoteHost(options: RemoteHostOptions): Promise<RunnerAdapter> {
  const deadlines = { ...REMOTE_DEADLINES, ...options.deadlines };
  const callMs = deadlines.callMs ?? 300_000;
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
  let requests: HostRequests | null = null;
  const install = async (on: HostRequests) => {
    const done = (await on.request("install", [], deadlines.installMs)) as InstallAnswer;
    if (done.ran) log(`${target.destination}: installed with ${done.command}`);
  };
  const { coverage: _off, ...adapterOptions } = options.options;
  return startHostProxy({
    channel: channelOf(spawnSsh(target, command)),
    runner: options.runner,
    version: options.version,
    // Spec 021 D12: coverage stays off on a remote lane.
    options: adapterOptions,
    policy: () => ({ ...options.policy(), coverage: false, coverageChildren: false }),
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.optimizer === undefined ? {} : { optimizer: options.optimizer }),
    ...(options.deadlines === undefined ? {} : { deadlines: options.deadlines }),
    prepare: async (on) => {
      requests = on;
      const entries = await treeEntries(root);
      const { missing } = (await on.request("tree", [entries], callMs)) as TreeAnswer;
      const paths = new Set(entries.map((entry) => entry.path));
      for (const write of await writesFor(root, missing, paths)) {
        await on.request("write", [write], callMs);
      }
      log(`${target.destination}: tree of ${entries.length} files, ${missing.length} sent`);
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
  }).then(withLogs);
}

/** `adapter` whose runs' reports carry their logs: written into the run's own `logDir`. */
function withLogs(adapter: RunnerAdapter): RunnerAdapter {
  const run = adapter.run.bind(adapter);
  adapter.run = async (testFiles, options) => {
    const report = (await run(testFiles, options)) as RunReport & { logs?: readonly WireLog[] };
    const { logs, ...rest } = report;
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
