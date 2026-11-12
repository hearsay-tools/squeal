import { coreEnvironmentInputs, installedDependenciesFingerprint } from "../../keys/environment.js";
import type { AbsolutePath } from "../../types/common.js";
import type { RunnerAdapter } from "../../types/runner.js";
import type { RemoteHost } from "./connect.js";
import { environmentDifferences } from "./environment.js";
import { readEntry } from "./tree.js";
import { insideRoot } from "./tree-wire.js";

/*
 * Spec 021 D11.2 (rows 021-14, 021-24): the lane's comparison of a remote's
 * environment with this worktree's, before every remote run. When the
 * difference is the remote's installed dependencies, the host installs once
 * and the comparison runs again: a restore onto a new machine leaves an
 * install the key no longer reads as the lockfile's (`boat-trial.md` D3).
 */

export interface CompareOptions {
  readonly target: string;
  readonly root: AbsolutePath;
  readonly version: string;
  /** The runner here, whose environment the remote's must equal. */
  readonly local: RunnerAdapter;
  readonly allowlist: () => readonly string[];
  readonly log: (text: string) => void;
}

/** The differences of the remote's install that an install there may mend. */
const INSTALL_DIFFERS = [
  "installed dependencies differ",
  "no installed dependencies on the remote",
];

/**
 * What differs between `host`'s environment and this worktree's, one text
 * each; `[]`: equal. A difference in the remote's install asks the host to
 * install once and compares again. The host installs only when its install
 * changed since it made it (`tree-install.ts`), so a difference an install
 * cannot mend stands at once, and no later comparison installs for it again.
 */
export async function compareRemote(host: RemoteHost, options: CompareOptions): Promise<string[]> {
  const unequal = await differences(host, options).catch((error: Error) => [error.message]);
  if (!unequal.some((text) => INSTALL_DIFFERS.includes(text))) return unequal;
  const done = await host.install().catch((error: Error) => error);
  if (done instanceof Error) return [...unequal, done.message];
  if (!done.ran) return unequal;
  options.log(
    `remote ${options.target}: ${unequal.join("; ")}; installed again with ${done.command}`,
  );
  return differences(host, options).catch((error: Error) => [error.message]);
}

async function differences(host: RemoteHost, options: CompareOptions): Promise<string[]> {
  const allowlist = options.allowlist();
  const [remoteCore, remoteRunners, localRunners, installed] = await Promise.all([
    host.coreEnvironment(allowlist),
    host.adapter.environment(),
    options.local.environment(),
    installedDependenciesFingerprint(options.root, options.root),
  ]);
  const files = [...new Set([...remoteRunners, ...localRunners].flatMap((r) => r.files))];
  const [remoteBlobs, localBlobs] = await Promise.all([
    host.blobs(files),
    blobsAt(options.root, files),
  ]);
  const core = coreEnvironmentInputs({
    squealVersion: options.version,
    installedDependencies: installed,
    allowlist,
  });
  return environmentDifferences(
    {
      core: { ...remoteCore, squealVersion: options.version },
      runners: remoteRunners,
      blob: (p) => remoteBlobs[p] ?? null,
    },
    { core, runners: localRunners, blob: (p) => localBlobs[p] ?? null },
  );
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
