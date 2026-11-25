import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { coreEnvironmentInputs, installedDependenciesFingerprint } from "../../keys/environment.js";
import { readPin } from "../../node-pin.js";
import type { AbsolutePath } from "../../types/common.js";
import type { CoreEnvironmentInputs } from "../../types/keys.js";
import type { RunnerAdapter } from "../../types/runner.js";
import type { BlobCache, InstalledFingerprintCache } from "./blob-cache.js";
import type { RemoteHost } from "./connect.js";
import { environmentDifferences } from "./environment.js";
import { gitVersionRefusal, localGitVersion } from "./git-version.js";
import { type EnvironmentMode, sameMachine } from "./remote-key.js";
import { readEntry } from "./tree.js";
import { insideRoot } from "./tree-wire.js";

/*
 * Spec 021 D11.2 (rows 021-14, 021-24): the lane's comparison of a remote's
 * environment with this worktree's, before every remote run. When the
 * difference is the remote's installed dependencies, the host installs once
 * and the comparison runs again: a restore onto a new machine leaves an
 * install the key no longer reads as the lockfile's (`boat-trial.md` D3).
 *
 * Spec 026 D10 (row 026-14): under `environmentMode: "remote-key"` the
 * remote's platform, arch and pinned Node may differ, and the comparison
 * gives the remote's core, which the lane keys its results under.
 *
 * Row 026-27: a remote whose results go under this machine's keys (under
 * `match-local`, or `remote-key` on the same machine) must have a Git at
 * least as new as this one's, by `major.minor` (`git-version.ts`).
 */

export interface CompareOptions {
  readonly target: string;
  readonly root: AbsolutePath;
  readonly version: string;
  /** The runner here, whose environment the remote's must equal. */
  readonly local: RunnerAdapter;
  /**
   * Spec 026 D8.3 (row 026-12): under `remote`, the runner here is not
   * asked: the remote's own runner environments are checked against this
   * worktree's process inputs and the blob ids of their config files here.
   */
  readonly planning?: "local" | "remote";
  /** Spec 026 D10: `remote-key` lets the remote's machine differ; absent: `match-local`. */
  readonly environmentMode?: EnvironmentMode;
  readonly allowlist: () => readonly string[];
  readonly log: (text: string) => void;
  /** Optional stat-cached blob reader for local config files. */
  readonly blobCache?: BlobCache;
  /** Optional stat-guarded cache for local `installedDependenciesFingerprint`. */
  readonly installedCache?: InstalledFingerprintCache;
  /** Row 026-27: `git --version` here; absent: read once (`localGitVersion`). */
  readonly localGitVersion?: string | null;
}

/** The differences of the remote's install that an install there may mend. */
const INSTALL_DIFFERS = [
  "installed dependencies differ",
  "no installed dependencies on the remote",
];

/** What a comparison found: what differs, one text each (`[]`: equal), and the remote's core it read. */
export interface RemoteComparison {
  readonly differences: string[];
  /** `null` when the remote could not be read. */
  readonly remoteCore: CoreEnvironmentInputs | null;
}

/**
 * What differs between `host`'s environment and this worktree's, one text
 * each; `[]`: equal. A difference in the remote's install asks the host to
 * install once and compares again. The host installs only when its install
 * changed since it made it (`tree-install.ts`), so a difference an install
 * cannot mend stands at once, and no later comparison installs for it again.
 */
export async function compareRemote(host: RemoteHost, options: CompareOptions): Promise<string[]> {
  return (await compareRemoteEnvironment(host, options)).differences;
}

/** `compareRemote` with the remote's core, which `remote-key` keys results under (D10.2). */
export async function compareRemoteEnvironment(
  host: RemoteHost,
  options: CompareOptions,
): Promise<RemoteComparison> {
  const first = await compared(host, options);
  const unequal = first.differences;
  if (!unequal.some((text) => INSTALL_DIFFERS.includes(text))) return first;
  const done = await host.install().catch((error: Error) => error);
  if (done instanceof Error) return { ...first, differences: [...unequal, done.message] };
  if (!done.ran) return first;
  options.log(
    `remote ${options.target}: ${unequal.join("; ")}; installed again with ${done.command}`,
  );
  return compared(host, options);
}

async function compared(host: RemoteHost, options: CompareOptions): Promise<RemoteComparison> {
  return differences(host, options).catch((error: Error) => ({
    differences: [error.message],
    remoteCore: null,
  }));
}

async function differences(host: RemoteHost, options: CompareOptions): Promise<RemoteComparison> {
  const allowlist = options.allowlist();
  const remoteKey = options.environmentMode === "remote-key";
  const [remoteOwn, remoteRunners, localOwn, installed, nodePins] = await Promise.all([
    host.coreEnvironment(allowlist),
    host.adapter.environment(),
    options.planning === "remote" ? null : options.local.environment(),
    options.installedCache !== undefined
      ? options.installedCache.fingerprint()
      : installedDependenciesFingerprint(options.root, options.root),
    remoteKey ? nodePinsAt(options.root) : [],
  ]);
  const localRunners = localOwn ?? remoteRunners;
  const files = [...new Set([...remoteRunners, ...localRunners].flatMap((r) => r.files))];
  const [remoteBlobs, localBlobs] = await Promise.all([
    host.blobs(files),
    options.blobCache !== undefined ? options.blobCache.blobs(files) : blobsAt(options.root, files),
  ]);
  const core = coreEnvironmentInputs({
    squealVersion: options.version,
    installedDependencies: installed,
    allowlist,
  });
  const remoteCore = { ...remoteOwn, squealVersion: options.version };
  const found = environmentDifferences(
    { core: remoteCore, runners: remoteRunners, blob: (p) => remoteBlobs[p] ?? null },
    { core, runners: localRunners, blob: (p) => localBlobs[p] ?? null },
    remoteKey ? { mode: "remote-key", nodePins } : {},
  );
  // Row 026-27: results stored under this machine's keys need a Git as new as this machine's.
  if (!remoteKey || sameMachine(remoteCore, core)) {
    const local =
      options.localGitVersion !== undefined ? options.localGitVersion : localGitVersion();
    const refusal = gitVersionRefusal(host.gitVersion, local);
    if (refusal !== null) found.push(refusal);
  }
  return { differences: found, remoteCore };
}

/**
 * D10.2: the Node versions the project at `root` pins, which a remote's Node
 * meets under `remote-key`: the `.node-version` or `.nvmrc` value, and
 * `package.json`'s `engines.node`.
 */
export async function nodePinsAt(root: AbsolutePath): Promise<string[]> {
  const pins: string[] = [];
  const pin = readPin(root);
  if (pin !== null) pins.push(pin);
  const engines = await readFile(join(root, "package.json"), "utf8")
    .then((text) => (JSON.parse(text) as { engines?: { node?: unknown } }).engines?.node)
    .catch(() => undefined);
  if (typeof engines === "string" && engines.trim() !== "") pins.push(engines.trim());
  return pins;
}

/** The blob id of each of `paths` under `root` now; `null`: absent, or outside the root. */
export async function blobsAt(
  root: AbsolutePath,
  paths: readonly string[],
): Promise<Record<string, string | null>> {
  const blobs: Record<string, string | null> = {};
  for (const path of paths) {
    blobs[path] = insideRoot(path) ? ((await readEntry(root, path))?.entry.blob ?? null) : null;
  }
  return blobs;
}
