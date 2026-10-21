import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import {
  bundleOptions,
  copyNodeTestRuntime,
  copyObserveRuntime,
  copyPytestRuntime,
  REPO_ROOT,
  writePluginVersions,
} from "../../../src/harness/build.js";
import {
  CODEX_MANIFEST,
  CODEX_PLUGIN,
  CODEX_PLUGIN_DIR,
  CODEX_SKILL,
  noteCodexCommand,
  SKILL_SOURCE,
} from "../../../src/harness/codex/build.js";

/*
 * Codex's plugin cache in a temporary directory (`research/plugin-cache-cleanup.md`
 * 4): each version as `codex plugin add` copies it, under
 * `<home>/.codex/plugins/cache/hearsay/squeal/<version>`, and `remove`, the
 * `rm -rf` that is exactly Codex's `remove_old_plugin_versions`. The plugin
 * data directory is where Codex 0.160.1 names it to hooks.
 */

/** Two versions of one release line, A before B. */
export const A = "0.1.900";
export const B = "0.1.901";

/**
 * Builds the Codex plugin into `dir` with its bundles at `version`: the
 * manifest, hooks, launcher and skills of `plugins/codex`, the skill from its
 * source with the Codex note, as `npm run build:plugin` makes it.
 */
export async function codexPluginAt(dir: string, version: string): Promise<void> {
  cpSync(CODEX_PLUGIN_DIR, dir, {
    recursive: true,
    filter: (from) => !from.startsWith(join(CODEX_PLUGIN_DIR, "dist")),
  });
  rmSync(join(dir, CODEX_SKILL), { recursive: true, force: true });
  cpSync(join(REPO_ROOT, SKILL_SOURCE), join(dir, CODEX_SKILL), { recursive: true });
  noteCodexCommand(join(dir, CODEX_SKILL));
  writePluginVersions(dir, [CODEX_MANIFEST], version);
  const dist = join(dir, "dist");
  await build({
    ...bundleOptions(CODEX_PLUGIN, dist),
    define: { __SQUEAL_VERSION__: JSON.stringify(version) },
  });
  copyNodeTestRuntime(dist);
  copyObserveRuntime(dist);
  copyPytestRuntime(dist);
}

/** Plugins built once per test file, copied into each machine's cache. */
export interface Built {
  readonly dir: string;
  readonly cleanup: () => void;
}

export async function buildVersions(versions: readonly string[]): Promise<Built> {
  const dir = mkdtempSync("/tmp/sq-vc-built-");
  for (const v of versions) await codexPluginAt(join(dir, v), v);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface CodexMachine {
  readonly dir: string;
  readonly home: string;
  readonly cache: string;
  /** `PLUGIN_DATA` as Codex gives it to the plugin's hooks. */
  readonly data: string;
  /** `node` and the system tools, no `squeal`. */
  readonly path: string;
  rootOf(version: string): string;
  /** Copies `version` into the cache, as an install does. */
  install(version: string): string;
  /** Codex's install of another version: the directory of `version` is gone. */
  remove(version: string): void;
  /** Runs `command` in bash in `cwd` with this machine's HOME and PATH, plus `env`. */
  shell(
    command: string,
    cwd: string,
    env?: Readonly<Record<string, string>>,
  ): { status: number | null; stdout: string; stderr: string };
  cleanup(): void;
}

export function codexMachine(built: Built): CodexMachine {
  const dir = mkdtempSync("/tmp/sq-vc-");
  const home = join(dir, "home");
  const codex = join(home, ".codex", "plugins");
  const cache = join(codex, "cache", "hearsay", "squeal");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, "node"));
  const path = `${bin}:/usr/bin:/bin`;
  const rootOf = (version: string) => join(cache, version);
  return {
    dir,
    home,
    cache,
    data: join(codex, "data", "squeal-hearsay"),
    path,
    rootOf,
    install(version) {
      cpSync(join(built.dir, version), rootOf(version), { recursive: true });
      return rootOf(version);
    },
    remove(version) {
      rmSync(rootOf(version), { recursive: true, force: true });
    },
    shell(command, cwd, env = {}) {
      return spawnSync("bash", ["-c", command], {
        cwd,
        env: { PATH: path, HOME: home, ...env },
        encoding: "utf8",
      });
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
