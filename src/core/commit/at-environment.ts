import type { EnvironmentDescriptor } from "../keys/environment-descriptor.js";
import type { StoredEnvironment } from "../store/environments.js";
import type { RelativePath } from "../types/common.js";
import type { EnvironmentHash, FileHash } from "../types/keys.js";
import { installedPart, type LockfileSides, runnerPins } from "./at-environment-lockfile.js";

/*
 * Spec 023 D2.2: one project's environment hash at a commit, from git
 * objects and the stored environments, with no install. The first step that
 * yields exactly one hash decides (`research/environment-at-commit.md`,
 * recommendation):
 *
 * 1. The commit's runner files and lockfile equal this worktree's: this
 *    worktree's hash.
 * 2. pnpm: the installed part computed from the commit's lockfile; the
 *    stored environments with this machine's inputs (key format, Node,
 *    platform, arch, adapter, runner, allow-listed variables), the commit's
 *    runner files and that installed part. One hash: it. More: not
 *    determined. A project whose stored environments already show equal
 *    inputs under more than one hash (a config that reads files outside its
 *    runner files) skips this step (human, 2026-11-16: refuse).
 * 3. pnpm, only the lockfile differs and it resolves the runner to the same
 *    version: this worktree's inputs with the computed installed part.
 * 4. Otherwise not determined; an install at the commit gives the hash.
 *
 * Other lockfiles (npm, Yarn) stop at step 1 (D2.3).
 */

/** The step that gave the hash. */
export type EnvironmentStep = 1 | 2 | 3;

/** One project's environment at a commit: its hash, or why it is not determined. */
export type EnvironmentAt =
  | { readonly hash: EnvironmentHash; readonly step: EnvironmentStep }
  | { readonly notDetermined: string };

/** What `environmentAt` reads for one project. */
export interface EnvironmentAtInput {
  /** This worktree's stored environment of the project (`worktreeEnvironment`). */
  readonly here: StoredEnvironment | null;
  /** Every stored environment of the project (`projectEnvironments`). */
  readonly stored: readonly StoredEnvironment[];
  /** The blob of each file the commit holds. */
  readonly blobs: ReadonlyMap<RelativePath, FileHash>;
  /** The project's committed lockfile here and at the commit (`readLockfileSides`). */
  readonly lockfile: LockfileSides;
  /**
   * Step 3: this worktree's environment hash with `installed` as its
   * installed-dependency part, every other input as its daemon has it
   * (`environmentHash` over the runner's environment). Absent: step 3 is
   * not taken.
   */
  readonly rehash?: (installed: string) => EnvironmentHash;
}

/** The project's environment hash at the commit, by D2.2's steps. */
export function environmentAt(input: EnvironmentAtInput): EnvironmentAt {
  const { here, blobs, lockfile } = input;
  if (here === null) return { notDetermined: "no environment recorded for this worktree" };
  const local = here.descriptor;
  if (local === null) return { notDetermined: "this worktree's environment has no descriptor" };
  const filesEqual = sameFiles(local, blobs);
  if (filesEqual && lockfile.here === lockfile.there) return { hash: here.hash, step: 1 };
  if (lockfile.manager !== "pnpm" || lockfile.thereText === null) {
    return { notDetermined: filesEqual ? "the lockfile differs" : "runner files differ" };
  }
  const installed = installedPart(lockfile.thereText);
  if (installed === null) return { notDetermined: "the commit's lockfile is not pnpm 12's" };
  if (!ambiguous(input.stored)) {
    const pinned = (runnerPins(lockfile.thereText, local.runnerName) ?? []).length > 0;
    const matches = new Set(
      input.stored
        .filter(
          ({ descriptor }) => descriptor !== null && descriptor.installedDependencies === installed,
        )
        .filter(({ descriptor }) => sameMachine(descriptor as EnvironmentDescriptor, local, pinned))
        .filter(({ descriptor }) => sameFiles(descriptor as EnvironmentDescriptor, blobs))
        .map(({ hash }) => hash),
    );
    if (matches.size > 1) return { notDetermined: "more than one stored environment matches" };
    const [hash] = matches;
    if (hash !== undefined) return { hash, step: 2 };
  }
  if (!filesEqual) return { notDetermined: "runner files differ" };
  return derived(input, local, installed);
}

/** Step 3, once the runner files are equal and only the lockfile differs. */
function derived(
  input: EnvironmentAtInput,
  local: EnvironmentDescriptor,
  installed: string,
): EnvironmentAt {
  const { lockfile, rehash } = input;
  const hereInstalled = lockfile.hereText === null ? null : installedPart(lockfile.hereText);
  if (hereInstalled !== local.installedDependencies) {
    return { notDetermined: "this worktree's install is not its lockfile's whole fingerprint" };
  }
  const there = runnerPins(lockfile.thereText ?? "", local.runnerName);
  const ours = runnerPins(lockfile.hereText ?? "", local.runnerName);
  if (there === null || ours === null || there.join() !== ours.join()) {
    return { notDetermined: "the lockfile changes the runner" };
  }
  if (rehash === undefined) return { notDetermined: "the lockfile differs" };
  return { hash: rehash(installed), step: 3 };
}

/** Whether every runner file of `descriptor` has, at the commit, the hash it holds (`null`: absent). */
function sameFiles(
  descriptor: EnvironmentDescriptor,
  blobs: ReadonlyMap<RelativePath, FileHash>,
): boolean {
  return descriptor.files.every(([path, hash]) => (blobs.get(path) ?? null) === hash);
}

/**
 * Whether `stored` holds this machine's inputs as `local` does. The runner
 * version is compared unless the commit's lockfile pins the runner, whose
 * version the installed part then holds.
 */
function sameMachine(
  stored: EnvironmentDescriptor,
  local: EnvironmentDescriptor,
  pinned: boolean,
): boolean {
  return (
    stored.keyFormat === local.keyFormat &&
    stored.project === local.project &&
    stored.runnerName === local.runnerName &&
    (pinned || stored.runnerVersion === local.runnerVersion) &&
    stored.adapterVersion === local.adapterVersion &&
    stored.nodeVersion === local.nodeVersion &&
    stored.platform === local.platform &&
    stored.arch === local.arch &&
    stored.env.hash === local.env.hash
  );
}

/**
 * Whether two stored environments share every input but the resolved
 * config under different hashes: the config reads more than its runner
 * files, so one match proves nothing (D2.2, human 2026-11-16).
 */
export function ambiguous(stored: readonly StoredEnvironment[]): boolean {
  const seen = new Map<string, EnvironmentHash>();
  for (const { hash, descriptor } of stored) {
    if (descriptor === null) continue;
    const inputs = JSON.stringify([
      descriptor.keyFormat,
      descriptor.runnerName,
      descriptor.runnerVersion,
      descriptor.adapterVersion,
      descriptor.nodeVersion,
      descriptor.platform,
      descriptor.arch,
      descriptor.installedDependencies,
      descriptor.env.hash,
      descriptor.files,
    ]);
    const other = seen.get(inputs);
    if (other !== undefined && other !== hash) return true;
    seen.set(inputs, hash);
  }
  return false;
}
