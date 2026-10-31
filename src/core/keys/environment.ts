import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { compare, toRelative } from "../fs/index.js";
import type { AbsolutePath, CoreEnvironmentInputs, RelativePath } from "../types/index.js";
import { listEntries, readIfFile } from "./files.js";
import { HIDDEN_LOCKFILE } from "./hidden-lockfile.js";
import type { PackageScans } from "./package-scans.js";
import { type LockfileReader, npmReading, type PackageGraph, WHOLE } from "./packages.js";
import { pnpmReading } from "./pnpm-install.js";
import { PNPM_LOCKFILE } from "./pnpm-lockfile.js";

/** The whole fingerprint's encoding of a trusted hidden lockfile and of pnpm's (task 011-85). */
const INSTALLED_ENCODING = "squeal-installed/2";

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
 * the patches directory each package manager applies and, for npm's and
 * pnpm's, the reader per-package keys take it by. First match wins.
 */
const LOCKFILES: readonly {
  readonly path: string;
  readonly patches: string | null;
  readonly read?: LockfileReader;
}[] = [
  { path: HIDDEN_LOCKFILE, patches: "patches", read: npmReading },
  { path: "node_modules/.yarn-state.yml", patches: null },
  { path: ".pnp.cjs", patches: ".yarn/patches" },
  { path: ".pnp.js", patches: ".yarn/patches" },
  { path: "node_modules/.yarn-integrity", patches: "patches" },
  { path: PNPM_LOCKFILE, patches: null, read: pnpmReading },
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
  /** Why npm's hidden lockfile or pnpm's `lock.yaml` does not describe the install, or `null`. */
  readonly note: string | null;
  /**
   * The package graph per-package keys read (tasks 001-105, 011-162), as
   * `npmReading` or `pnpmReading` gives it. `null` for any other lockfile
   * format or layout, a stale or unreadable lockfile, or no install; keys
   * then hold the whole `fingerprint`.
   */
  readonly graph: PackageGraph | null;
  /** Hash of the patches directory the package manager applies; part of `fingerprint` too. */
  readonly patches: string;
}

/**
 * Spec 001 D3: "the installed-dependency fingerprint (installed lockfile
 * metadata under `node_modules` plus `patches/`)". Unlike Vitest, which adds
 * the patches directory's mtime, this hashes the patch contents, because an
 * mtime differs between two worktrees with identical patches.
 *
 * npm's hidden lockfile and pnpm's `lock.yaml` enter as their readers give
 * them (`npmReading`, `pnpmReading`): while one does not describe the
 * install, its package folders, so an install that bypassed the file still
 * re-keys, and the note says so; else without what a release rewrites (task
 * 011-85). `note` is `null` otherwise. Any other lockfile enters whole.
 */
export async function installedDependencies(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
  scans?: PackageScans,
): Promise<InstalledDependencies> {
  const found = await locateLockfile(projectRoot, worktreeRoot);
  if (found === null) return { fingerprint: "none", note: null, graph: null, patches: "none" };
  const { dir, base, format, content } = found;
  const reading = format.read?.(dir, base, content, scans) ?? WHOLE;
  const hash = createHash("sha256").update(`${format.path}\0`);
  if (reading.stale !== null) hash.update(`stale\0${reading.folders}`);
  else if (reading.text !== null) hash.update(`${INSTALLED_ENCODING}\0${reading.text}`);
  else hash.update(content);
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
    reading.stale === null
      ? null
      : `${lockfile} does not describe the installed packages (${reading.stale}); ` +
        `dependencies are keyed by their package.json files until ${reading.manager} rewrites it`;
  return {
    fingerprint: hash.digest("hex"),
    note,
    graph: reading.graph,
    patches: patches.digest("hex"),
  };
}

/** An installed lockfile `locateLockfile` found: the directory that holds it, its format and bytes. */
interface Located {
  readonly dir: AbsolutePath;
  /** `dir` relative to the worktree, `null` outside it. */
  readonly base: RelativePath | null;
  readonly format: (typeof LOCKFILES)[number];
  readonly content: Buffer;
}

/**
 * First installed lockfile in `projectRoot`, then its parents up to
 * `worktreeRoot`, never above it: another worktree's `node_modules` is not
 * this one's. First match wins.
 */
async function locateLockfile(
  projectRoot: AbsolutePath,
  worktreeRoot: AbsolutePath,
): Promise<Located | null> {
  for (let dir = projectRoot; ; dir = dirname(dir)) {
    for (const format of LOCKFILES) {
      const content = await readIfFile(join(dir, format.path));
      if (content === null) continue;
      const base = resolve(dir) === resolve(worktreeRoot) ? "" : toRelative(worktreeRoot, dir);
      return { dir, base, format, content };
    }
    // `null` for the worktree root itself and anything outside it.
    if (dirname(dir) === dir || toRelative(worktreeRoot, dir) === null) return null;
  }
}
