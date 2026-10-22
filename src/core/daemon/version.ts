import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../fs/index.js";

/**
 * The root manifest's version, set by the plugin build's esbuild `define`
 * (src/harness/claude-code/build.ts). Undeclared in the `tsc` build, where
 * `typeof` reads it as `undefined`.
 */
declare const __SQUEAL_VERSION__: string | undefined;

/** What `squealVersion` reports when no source of a version exists. */
export const UNKNOWN_VERSION = "0.0.0-unknown";

/** The manifest name `manifestVersion` looks for. */
const PACKAGE_NAME = "squeal";

/**
 * Squeal's version, recorded with the daemon (D10) and part of every
 * environment hash (D3). Review wave 3, B1: one source for the `tsc` build
 * and the plugin bundles. A bundle carries the root manifest's version from
 * its build; the `tsc` build reads the manifest named `squeal` above this
 * module. Never throws: the daemon reads it after its store opened.
 */
export function squealVersion(): string {
  if (typeof __SQUEAL_VERSION__ === "string") return __SQUEAL_VERSION__;
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}

/**
 * `version` of the nearest `package.json` named `squeal` in a directory
 * above `module`; `null` when there is none. Manifests of other packages,
 * such as the plugin's own, and unreadable ones are passed over.
 */
export function manifestVersion(module: URL): string | null {
  let dir = dirname(fileURLToPath(module));
  for (;;) {
    const version = readVersion(join(dir, "package.json"));
    if (version !== null) return version;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readVersion(path: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { name, version } = parsed as { name?: unknown; version?: unknown };
    return name === PACKAGE_NAME && typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * True when `version` is strictly newer than `than`, both plain
 * `major.minor.patch` (lessons, defect 26). Anything else, a pre-release or
 * `UNKNOWN_VERSION` included, compares as not newer, so a hook or daemon of
 * an unknown version never replaces another.
 */
export function isNewerVersion(version: string, than: string): boolean {
  const a = versionParts(version);
  const b = versionParts(than);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}

/**
 * A `squeal@<marketplace>` entry of Claude Code's `installed_plugins.json`.
 * A key the entry lacks, or holds as no string, is `null`.
 */
export interface ClaudeInstall {
  readonly scope: string | null;
  readonly projectPath: string | null;
  readonly version: string | null;
  readonly installPath: string | null;
}

/**
 * The `squeal@<marketplace>` entries of `<plugins>/installed_plugins.json`,
 * the file Claude Code writes in its plugins directory and Squeal never
 * writes (002 D1); none when it is missing or cannot be read.
 */
export function claudeInstalls(plugins: string, marketplace: string): ClaudeInstall[] {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(join(plugins, "installed_plugins.json"), "utf8"));
  } catch {
    // No Claude Code install, or a file this version cannot read.
    return [];
  }
  const entries =
    isRecord(file) && isRecord(file.plugins) ? file.plugins[`squeal@${marketplace}`] : null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return (Array.isArray(entries) ? entries : []).filter(isRecord).map((entry) => ({
    scope: text(entry.scope),
    projectPath: text(entry.projectPath),
    version: text(entry.version),
    installPath: text(entry.installPath),
  }));
}

/**
 * The entry a Claude Code session in `root` loads: the first with a version
 * that is user scope, or project scope for `root` (005
 * `research/wave-0-checks.md` 5); `null` when none is.
 */
export function claudeLoaded(
  plugins: string,
  marketplace: string,
  root: string | null,
): { readonly version: string; readonly scope: string } | null {
  for (const { scope, projectPath, version } of claudeInstalls(plugins, marketplace)) {
    if (version === null || scope === null) continue;
    if (scope === "user" || (scope === "project" && root !== null && projectPath === root))
      return { version, scope };
  }
  return null;
}

/**
 * The newest version in the Codex plugin cache under `plugins`, by its
 * directory names in `cache/<marketplace>/squeal`; names that are no plain
 * `major.minor.patch` are passed over. `null` when it holds none.
 */
export function codexNewest(plugins: string, marketplace: string): string | null {
  let names: string[];
  try {
    names = readdirSync(join(plugins, "cache", marketplace, "squeal"));
  } catch {
    // No Codex install, or none of this marketplace.
    return null;
  }
  let newest: string | null = null;
  for (const name of names)
    if (versionParts(name) !== null && (newest === null || isNewerVersion(name, newest)))
      newest = name;
  return newest;
}
