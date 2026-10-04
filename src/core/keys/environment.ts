import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { isMissing } from "../fs/index.js";
import type {
  AbsolutePath,
  CoreEnvironmentInputs,
  EnvironmentHash,
  FileHash,
  RelativePath,
  RunnerEnvironment,
} from "../types/index.js";
import { compare } from "./closure.js";

/** Bumped when the encoding below changes, so old keys can never collide with new ones. */
const ENVIRONMENT_ENCODING = "squeal-environment/1";

/**
 * Environment hash of one runner project in one worktree.
 *
 * Spec 001 D3: "Squeal version and runner-adapter version, Vitest and Node
 * versions, platform and arch, the resolved Vitest config, the contents of the
 * config file and its `configFileDependencies`, the closure of every
 * `setupFiles` and `globalSetup` entry, the installed-dependency fingerprint
 * [...], allow-listed environment variables". Env variables and runner files
 * are sorted, so their order does not matter. Fields are JSON-encoded, so no
 * two different inputs share an encoding.
 *
 * `hashOf` hashes the runner files, normally `StatCache.hashOf`, so they get
 * the same file hash as closure paths (D3: "One definition everywhere"). `null`
 * is an absent file. `undefined` is a path the caller never hashed; it throws
 * rather than encoding an unknown file as absent.
 */
export function environmentHash(
  core: CoreEnvironmentInputs,
  runner: RunnerEnvironment,
  hashOf: (path: RelativePath) => FileHash | null | undefined,
): EnvironmentHash {
  const files = [...new Set(runner.files)].sort(compare).map((path) => {
    const hash = hashOf(path);
    if (hash === undefined) {
      throw new Error(
        `squeal: environment of project "${runner.project}": runner file "${path}" has not been hashed`,
      );
    }
    return [path, hash] as const;
  });
  const encoded = JSON.stringify([
    ENVIRONMENT_ENCODING,
    core.squealVersion,
    core.nodeVersion,
    core.platform,
    core.arch,
    core.installedDependencies,
    Object.entries(core.env).sort(([a], [b]) => compare(a, b)),
    runner.project,
    runner.runnerName,
    runner.runnerVersion,
    runner.adapterVersion,
    runner.resolvedConfig,
    files,
  ]);
  return createHash("sha256").update(encoded).digest("hex");
}

export interface CoreEnvironmentOptions {
  readonly squealVersion: string;
  /** From `installedDependenciesFingerprint`. */
  readonly installedDependencies: string;
  /** Policy `env.allowlist`. */
  readonly allowlist: readonly string[];
  /** Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * The core's environment inputs for this process.
 *
 * The Node version is the full `process.version`: spec 001 open question 2
 * leaves the granularity open, and the full version can only cost misses,
 * never a wrong hit. Allow-listed variables that are unset are left out; a
 * variable set to the empty string is kept, because it differs from unset.
 */
export function coreEnvironmentInputs(options: CoreEnvironmentOptions): CoreEnvironmentInputs {
  const source = options.env ?? process.env;
  const env: Record<string, string> = {};
  for (const name of [...options.allowlist].sort(compare)) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    squealVersion: options.squealVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    installedDependencies: options.installedDependencies,
    env,
  };
}

/**
 * Installed-lockfile metadata, as Vitest's `getLockfileHash` finds it, with
 * the patches directory each package manager applies. First match wins.
 */
const LOCKFILES: readonly { readonly path: string; readonly patches: string | null }[] = [
  { path: "node_modules/.package-lock.json", patches: "patches" },
  { path: "node_modules/.yarn-state.yml", patches: null },
  { path: ".pnp.cjs", patches: ".yarn/patches" },
  { path: ".pnp.js", patches: ".yarn/patches" },
  { path: "node_modules/.yarn-integrity", patches: "patches" },
  { path: "node_modules/.pnpm/lock.yaml", patches: null },
  { path: ".rush/temp/shrinkwrap-deps.json", patches: null },
  { path: "bun.lock", patches: "patches" },
  { path: "bun.lockb", patches: "patches" },
];

/**
 * Fingerprint of the installed dependencies of a project, or `"none"` when no
 * installed lockfile exists.
 *
 * Spec 001 D3: "the installed-dependency fingerprint (installed lockfile
 * metadata under `node_modules` plus `patches/`)". Looks in `projectRoot`, then
 * its parents up to `worktreeRoot`, never above it: another worktree's
 * `node_modules` is not this one's. Unlike Vitest, which adds the patches
 * directory's mtime, this hashes the patch contents, because an mtime differs
 * between two worktrees with identical patches.
 */
export async function installedDependenciesFingerprint(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
): Promise<string> {
  for (let dir = projectRoot; ; dir = dirname(dir)) {
    for (const format of LOCKFILES) {
      const content = await readIfFile(join(dir, format.path));
      if (content === null) continue;
      const hash = createHash("sha256").update(`${format.path}\0`).update(content);
      if (format.patches !== null) {
        const patchesDir = join(dir, format.patches);
        for (const path of await listEntries(patchesDir)) {
          const bytes = await readIfFile(join(patchesDir, path));
          if (bytes !== null) hash.update(`\0${path}\0${bytes.byteLength}\0`).update(bytes);
        }
      }
      return hash.digest("hex");
    }
    if (
      dir === worktreeRoot ||
      dirname(dir) === dir ||
      relative(worktreeRoot, dir).startsWith("..")
    ) {
      return "none";
    }
  }
}

async function readIfFile(path: AbsolutePath): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Entries below `dir`, relative to it with `/` separators, sorted. Empty when `dir` is missing. */
async function listEntries(dir: AbsolutePath): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.map((entry) => entry.split(sep).join("/")).sort(compare);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
