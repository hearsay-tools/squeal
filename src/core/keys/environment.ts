import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { compare, isMissing, isRecord, toRelative } from "../fs/index.js";
import type {
  AbsolutePath,
  CoreEnvironmentInputs,
  EnvironmentHash,
  FileHash,
  RelativePath,
  RunnerEnvironment,
} from "../types/index.js";
import {
  HIDDEN_LOCKFILE,
  packageFoldersFingerprint,
  staleHiddenLockfile,
} from "./hidden-lockfile.js";
import { KEY_FORMAT_VERSION } from "./key-format.js";
import type { PackageScans } from "./package-scans.js";
import { InstalledGraph } from "./packages.js";

/** Bumped when the encoding below changes, so old keys can never collide with new ones. */
const ENVIRONMENT_ENCODING = "squeal-environment/1";

/**
 * Environment hash of one runner project in one worktree.
 *
 * Spec 001 D3: "the key format version and the runner-adapter version,
 * Vitest and Node versions, platform and arch, the resolved Vitest config, the contents of the
 * config file and its `configFileDependencies`, the closure of every
 * `setupFiles` and `globalSetup` entry, the installed-dependency fingerprint
 * [...], allow-listed environment variables". Env variables and runner files
 * are sorted, so their order does not matter. Fields are JSON-encoded, so no
 * two different inputs share an encoding. `core.squealVersion` is left out
 * (task 001-199): a release changes keys only through `KEY_FORMAT_VERSION` or
 * an adapter's version.
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
    KEY_FORMAT_VERSION,
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
  /** The daemon's version; never hashed (task 001-199), so a release alone keeps every key. */
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
  { path: HIDDEN_LOCKFILE, patches: "patches" },
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
 * Whether a worktree-relative path is an installed lockfile
 * `installedDependenciesFingerprint` reads, at the root or in a project
 * below it. Task 001-91: reports say when no dependencies are installed and
 * when a revision changed the installed lockfile.
 */
export function isInstalledLockfile(path: string): boolean {
  return LOCKFILES.some((format) => path === format.path || path.endsWith(`/${format.path}`));
}

/** An installed lockfile and the patches directory its package manager applies. */
export interface InstalledLockfile {
  readonly path: AbsolutePath;
  readonly patches: AbsolutePath | null;
}

/**
 * The installed lockfile `installedDependenciesFingerprint` reads, or `null`.
 * The daemon watches the file, which is usually gitignored, so `npm install`
 * re-keys every check (review S8).
 */
export async function findInstalledLockfile(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
): Promise<InstalledLockfile | null> {
  const found = await locateLockfile(projectRoot, worktreeRoot);
  if (found === null) return null;
  const { dir, format } = found;
  return {
    path: join(dir, format.path),
    patches: format.patches === null ? null : join(dir, format.patches),
  };
}

/**
 * Fingerprint of the installed dependencies of a project, or `"none"` when no
 * installed lockfile exists. The fingerprint of `installedDependencies`.
 */
export async function installedDependenciesFingerprint(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
): Promise<string> {
  return (await installedDependencies(projectRoot, worktreeRoot)).fingerprint;
}

/** The installed-dependency fingerprint and the note to show beside it. */
export interface InstalledDependencies {
  readonly fingerprint: string;
  /** Why npm's hidden lockfile does not describe the install, or `null`. */
  readonly note: string | null;
  /**
   * The package graph per-package keys read (task 001-105): only from npm's
   * hidden lockfile while npm would trust it. `null` for any other lockfile
   * format, a stale or unparsable hidden lockfile, or no install; keys then
   * hold the whole `fingerprint`.
   */
  readonly graph: InstalledGraph | null;
  /** Hash of the patches directory the package manager applies; part of `fingerprint` too. */
  readonly patches: string;
}

/**
 * Spec 001 D3: "the installed-dependency fingerprint (installed lockfile
 * metadata under `node_modules` plus `patches/`)". Unlike Vitest, which adds
 * the patches directory's mtime, this hashes the patch contents, because an
 * mtime differs between two worktrees with identical patches.
 *
 * Task 001-104: npm's hidden lockfile stands for the install only while npm
 * itself would trust it (`staleHiddenLockfile`). Otherwise the package
 * folders are fingerprinted instead, so an install that bypassed the file
 * still re-keys, and the note says so. `note` is `null` otherwise.
 */
export async function installedDependencies(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
  scans?: PackageScans,
): Promise<InstalledDependencies> {
  const found = await locateLockfile(projectRoot, worktreeRoot);
  if (found === null) return { fingerprint: "none", note: null, graph: null, patches: "none" };
  const { dir, format, content } = found;
  const stale = format.path === HIDDEN_LOCKFILE ? staleHiddenLockfile(dir, content) : null;
  const hash = createHash("sha256").update(`${format.path}\0`);
  if (stale === null) hash.update(content);
  else hash.update(`stale\0${packageFoldersFingerprint(dir, content)}`);
  const patches = createHash("sha256");
  if (format.patches !== null) {
    const patchesDir = join(dir, format.patches);
    for (const path of await listEntries(patchesDir)) {
      const bytes = await readIfFile(join(patchesDir, path));
      if (bytes === null) continue;
      for (const target of [hash, patches]) {
        target.update(`\0${path}\0${bytes.byteLength}\0`).update(bytes);
      }
    }
  }
  const lockfile = toRelative(worktreeRoot, join(dir, format.path)) ?? format.path;
  const note =
    stale === null
      ? null
      : `${lockfile} does not describe the installed packages (${stale}); ` +
        "dependencies are keyed by their package.json files until npm rewrites it";
  const listed = format.path === HIDDEN_LOCKFILE && stale === null ? packagesOf(content) : null;
  const base = resolve(dir) === resolve(worktreeRoot) ? "" : toRelative(worktreeRoot, dir);
  const graph =
    listed === null || base === null ? null : new InstalledGraph(dir, base, listed, scans);
  return { fingerprint: hash.digest("hex"), note, graph, patches: patches.digest("hex") };
}

/** The `packages` map of a hidden lockfile, or `null` when it has none. */
function packagesOf(content: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content.toString("utf8"));
    return isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : null;
  } catch {
    return null;
  }
}

/**
 * First installed lockfile in `projectRoot`, then its parents up to
 * `worktreeRoot`, never above it: another worktree's `node_modules` is not
 * this one's. First match wins.
 */
async function locateLockfile(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
): Promise<{ dir: AbsolutePath; format: (typeof LOCKFILES)[number]; content: Buffer } | null> {
  for (let dir = projectRoot; ; dir = dirname(dir)) {
    for (const format of LOCKFILES) {
      const content = await readIfFile(join(dir, format.path));
      if (content !== null) return { dir, format, content };
    }
    // `null` for the worktree root itself and anything outside it.
    if (dirname(dir) === dir || toRelative(worktreeRoot, dir) === null) return null;
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
