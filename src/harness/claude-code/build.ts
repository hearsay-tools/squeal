import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";
import {
  buildPlugin,
  type PluginBuild,
  bundleOptions as pluginBundleOptions,
  hookEntries as pluginHookEntries,
  REPO_ROOT,
  writePluginVersions as writeVersions,
} from "../build.js";

/*
 * The Claude Code plugin's build, on the shared one in src/harness/build.ts:
 * bundles under plugins/claude-code/dist/ (spec 001 D9) and the root version
 * in the plugin's manifests (001-76). Run by `npm run build:plugin`.
 */

export { REPO_ROOT, rootVersion } from "../build.js";
export const PLUGIN_DIR = join(REPO_ROOT, "plugins/claude-code");
export const PLUGIN_DIST = join(PLUGIN_DIR, "dist");

/**
 * Plugin files that carry the root version, relative to the plugin directory. Claude Code
 * updates an installed plugin only when the manifest's version changes (001-76).
 */
export const VERSIONED_PLUGIN_FILES = [".claude-plugin/plugin.json", "package.json"] as const;

export const CLAUDE_CODE_PLUGIN: PluginBuild = {
  pluginDir: PLUGIN_DIR,
  entriesDir: "src/harness/claude-code/entries",
  versionedFiles: VERSIONED_PLUGIN_FILES,
};

/** Hook bundle names: one per file in src/harness/claude-code/entries/. */
export function hookEntries(): string[] {
  return pluginHookEntries(CLAUDE_CODE_PLUGIN);
}

/** Writes `version` into each of {@link VERSIONED_PLUGIN_FILES} under `pluginDir`, keeping the rest. */
export function writePluginVersions(pluginDir: string, version?: string): void {
  writeVersions(pluginDir, VERSIONED_PLUGIN_FILES, version);
}

export function bundleOptions(outdir: string): BuildOptions {
  return pluginBundleOptions(CLAUDE_CODE_PLUGIN, outdir);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPlugin(CLAUDE_CODE_PLUGIN);
}
