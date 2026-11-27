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
import { readEntry, treePathsFor } from "./tree.js";
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
 *
 * Row 026-40 (#300; spec 026 D8, D12; 021 D11, D13): config and setup files
 * whose blob ids differ are sent again once (`resend`) and compared again,
 * as a proof difference is. One that Git ignores here is never sent (021
 * D10), and one that stays different after the resend is refused; each
 * refusal names its paths and the way out.
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
  /**
   * Row 026-40: sends `paths` as they are here and waits until they reached
   * the host. Absent: a config file difference is refused at once.
   */
  readonly resend?: (paths: readonly string[]) => Promise<void>;
}

/** The differences of the remote's install that an install there may mend. */
const INSTALL_DIFFERS = [
  "installed dependencies differ",
  "no installed dependencies on the remote",
];

/** Row 026-40: how many times a comparison sends differing config files again, new ones each time. */
const RESEND_ROUNDS = 2;

/** What a comparison found: what differs, one text each (`[]`: equal), and the remote's core it read. */
export interface RemoteComparison {
  readonly differences: string[];
  /** `null` when the remote could not be read. */
  readonly remoteCore: CoreEnvironmentInputs | null;
  /** Row 026-40: the config and setup files whose blob ids differ; absent, none. */
  readonly files?: readonly string[];
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
  return resent(host, options, await reinstalled(host, options, await compared(host, options)));
}

/** `first`, or after an install there when its difference is the remote's install. */
async function reinstalled(
  host: RemoteHost,
  options: CompareOptions,
  first: RemoteComparison,
): Promise<RemoteComparison> {
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

/**
 * Row 026-40: `found`, or after its differing config and setup files were
 * sent again and compared again. Each file goes again at most once; a
 * second round sends only the files the first round's comparison newly
 * named, such as a helper a resent setup file now imports. A file Git
 * ignores here is never sent, and a file still different after its resend
 * stays refused: the refusal names them and the way out.
 */
async function resent(
  host: RemoteHost,
  options: CompareOptions,
  found: RemoteComparison,
): Promise<RemoteComparison> {
  const sent = new Set<string>();
  let now = found;
  for (let round = 0; round < RESEND_ROUNDS; round++) {
    const files = (now.files ?? []).filter((path) => !sent.has(path));
    if (files.length === 0 || options.resend === undefined) break;
    const ignored = await ignoredHere(options.root, files);
    if (ignored.length > 0) {
      return { ...now, differences: [...now.differences, ignoredConfigReason(ignored)] };
    }
    options.log(
      `remote ${options.target}: config and setup files differ at ${listed(files)}; sending again`,
    );
    for (const path of files) sent.add(path);
    options.blobCache?.evict(files);
    await options.resend(files);
    now = await compared(host, options);
  }
  const stayed = (now.files ?? []).filter((path) => sent.has(path));
  if (stayed.length === 0) return now;
  return { ...now, differences: [...now.differences, stayedConfigReason(stayed)] };
}

/** Of `paths`, those that exist here though Git ignores them: no resend reaches the remote. */
async function ignoredHere(root: AbsolutePath, paths: readonly string[]): Promise<string[]> {
  const [inTree, here] = await Promise.all([
    treePathsFor(root, paths).catch(() => new Set(paths)),
    blobsAt(root, paths),
  ]);
  return paths.filter((path) => here[path] !== null && !inTree.has(path));
}

/** Up to five paths, as each refusal names them. */
function listed(paths: readonly string[]): string {
  return paths.slice(0, 5).join(", ");
}

/** Row 026-40: why config files Git ignores here refuse the remote, and the way out. */
export function ignoredConfigReason(paths: readonly string[]): string {
  return `config and setup files ${listed(paths)} are git-ignored here and never synced to remote; stop ignoring them, or list the test files that need them in remote.alwaysLocal`;
}

/** Row 026-40: why config files still different after one resend refuse the remote, and the way out. */
export function stayedConfigReason(paths: readonly string[]): string {
  return `config and setup files stayed different after one resend at ${listed(paths)}; something on the remote rewrites them: list the test files that need them in remote.alwaysLocal`;
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
  const differ = files.filter((path) => (remoteBlobs[path] ?? null) !== (localBlobs[path] ?? null));
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
  return { differences: found, remoteCore, ...(differ.length === 0 ? {} : { files: differ }) };
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
