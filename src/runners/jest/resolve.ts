import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { toRelative } from "../../core/fs/paths.js";
import type { AbsolutePath } from "../../core/types/common.js";

/** Spec 028 D2: the Jest majors Squeal drives, `>= 29.0.0 < 31.0.0`. */
export const JEST_MAJORS: readonly number[] = [29, 30];

/** The project's own Jest and the packages an adapter loads from it, each a real package folder. */
export interface JestInstall {
  /** `jest`'s `package.json` version, such as `29.7.0`. */
  readonly version: string;
  readonly major: number;
  readonly jest: AbsolutePath;
  /** The script `jest`'s `package.json` names as its `bin`. */
  readonly bin: AbsolutePath;
  readonly cli: AbsolutePath;
  readonly core: AbsolutePath;
  readonly config: AbsolutePath;
  readonly runtime: AbsolutePath;
}

/** A Jest to drive, or the one note that says why there is none and how to install one. */
export type JestResolution =
  | { readonly ok: true; readonly install: JestInstall }
  | { readonly ok: false; readonly note: string };

/**
 * D2.1: the Jest a project runs. `jest` is looked up in `node_modules` from
 * `cwd` up to the worktree `root` and never above it. The others are
 * resolved along their own dependency links, since pnpm hoists none of them:
 * `jest-cli` from `jest`, `@jest/core` and `jest-config` from `jest-cli`,
 * `jest-runtime` from `@jest/core` (research 028-01, `resolve-runtime.cjs`).
 */
export function resolveJest(
  project: string,
  cwd: AbsolutePath,
  root: AbsolutePath,
): JestResolution {
  const where = `jest project ${JSON.stringify(project)}`;
  const install = `install jest 29 or 30 in the project (for example \`npm install --save-dev jest\`); its checks stay unknown until then`;
  const jest = findInWorktree("jest", cwd, root);
  if (jest === null) {
    return {
      ok: false,
      note: `${where}: no jest package in node_modules from ${cwd} up to the worktree root; ${install}`,
    };
  }
  const manifest = readManifest(jest);
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const major = Number.parseInt(version, 10);
  if (!JEST_MAJORS.includes(major)) {
    return {
      ok: false,
      note: `${where}: jest ${version || "of no version"} at ${jest} is outside the supported >= 29.0.0 < 31.0.0; ${install}`,
    };
  }
  try {
    const cli = packageFrom("jest-cli", jest);
    const core = packageFrom("@jest/core", cli);
    return {
      ok: true,
      install: {
        version,
        major,
        jest,
        bin: binOf(jest, manifest),
        cli,
        core,
        config: packageFrom("jest-config", cli),
        runtime: packageFrom("jest-runtime", core),
      },
    };
  } catch (error) {
    return {
      ok: false,
      note: `${where}: jest ${version} at ${jest} is incomplete: ${(error as Error).message}; reinstall it; its checks stay unknown until then`,
    };
  }
}

/** The real folder of `name` in the first `node_modules` from `from` up to `root`, or `null`. */
function findInWorktree(name: string, from: AbsolutePath, root: AbsolutePath): AbsolutePath | null {
  for (const dir of upToRoot(from, root)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate) as AbsolutePath;
  }
  return null;
}

/** `from` and each folder above it up to `root`; none when `from` is outside `root`. Both as given, unresolved. */
function* upToRoot(from: string, root: string): Generator<string> {
  if (from !== root && toRelative(root as AbsolutePath, from as AbsolutePath) === null) return;
  for (let dir = from; ; dir = dirname(dir)) {
    yield dir;
    if (toRelative(root as AbsolutePath, dir as AbsolutePath) === null) return;
  }
}

/** The real folder of the package `name` as the package at `from` resolves it. */
function packageFrom(name: string, from: AbsolutePath): AbsolutePath {
  const require = createRequire(join(from, "package.json"));
  try {
    return dirname(realpathSync(require.resolve(`${name}/package.json`))) as AbsolutePath;
  } catch {
    // A package whose `exports` hides `package.json`: walk up from its entry to its folder.
    for (let dir = dirname(require.resolve(name)); dir !== dirname(dir); dir = dirname(dir)) {
      const path = join(dir, "package.json");
      if (existsSync(path) && readManifest(dir).name === name)
        return realpathSync(dir) as AbsolutePath;
    }
    throw new Error(`${name} has no package.json above its entry, resolved from ${from}`);
  }
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
}

function binOf(jest: AbsolutePath, manifest: Record<string, unknown>): AbsolutePath {
  const bin = manifest.bin;
  const script = typeof bin === "string" ? bin : (bin as Record<string, unknown> | undefined)?.jest;
  if (typeof script !== "string") throw new Error("jest's package.json names no jest bin");
  return join(jest, script) as AbsolutePath;
}

/** D2.2: the tsconfig names ts-node may take, in the order Squeal prefers them. */
const TSCONFIGS = ["tsconfig.spec.json", "tsconfig.json", "tsconfig.base.json"] as const;
const TS_CONFIG = new Set([".ts", ".mts", ".cts"]);

/**
 * D2.2 (research 028-01 F1.4): Jest 29 loads a TypeScript config through
 * ts-node, which searches up from the process's cwd for a `tsconfig.json`
 * and can load an unrelated TypeScript above the worktree. For such a config
 * and no `TS_NODE_PROJECT` in `env`, the variables that pin ts-node inside the
 * worktree: the nearest `tsconfig*.json` from the config's folder up to
 * `root`, or `TS_NODE_SKIP_PROJECT` when there is none. `{}` otherwise.
 */
export function tsNodeHygiene(
  major: number,
  config: AbsolutePath,
  root: AbsolutePath,
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  if (major !== 29 || !TS_CONFIG.has(extname(config)) || env.TS_NODE_PROJECT !== undefined)
    return {};
  for (const dir of upToRoot(dirname(config), root)) {
    for (const name of TSCONFIGS) {
      const path = join(dir, name);
      if (existsSync(path)) return { TS_NODE_PROJECT: path };
    }
  }
  return { TS_NODE_SKIP_PROJECT: "true" };
}
