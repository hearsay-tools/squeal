import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build, type Metafile } from "esbuild";
import {
  bundleOptions,
  copyNodeTestRuntime,
  copyObserveRuntime,
  copyPluginTrees,
  copyPytestRuntime,
  distOf,
  LAUNCHER_COPY,
  nodeFloor,
  type PluginBuild,
  REPO_ROOT,
  writePluginVersions,
} from "../build.js";

/*
 * The OpenCode package's build (spec 008 D1, D4, D6), on the shared one in
 * src/harness/build.ts: the bridge, one entry per request kind
 * (`dist/hooks/<kind>.mjs`, `bridgeFile`), beside the CLI,
 * the daemon and the runtime files, the root version in the package's
 * `package.json`, and the plugin `dist/plugin.mjs`, a bundle of its own: it
 * runs in OpenCode's Bun, so it gets no Node banner and reaches nothing of
 * the shared code (its import list is asserted by a build test). The
 * launcher is copied from the Claude Code plugin (005-76). Run by
 * `npm run build:plugin`.
 */

export const OPENCODE_PLUGIN_DIR = resolve(REPO_ROOT, "plugins/opencode");
export const OPENCODE_PLUGIN_DIST = resolve(OPENCODE_PLUGIN_DIR, "dist");
/** The plugin's entry, bundled alone as `dist/plugin.mjs`. */
export const PLUGIN_ENTRY = "src/harness/opencode/entries/plugin.ts";
/** The only modules `dist/plugin.mjs` may import (D4). */
export const PLUGIN_IMPORTS: readonly string[] = ["node:child_process", "node:fs", "node:path"];

export const OPENCODE_PLUGIN: PluginBuild = {
  pluginDir: OPENCODE_PLUGIN_DIR,
  // Each entry here is bundled as `dist/hooks/<name>.mjs` (`bridgeBundleOptions`).
  entriesDir: "src/harness/opencode/entries/hooks",
  versionedFiles: ["package.json"],
  copies: [LAUNCHER_COPY],
};

/** The shared bundle options with this package's hook entries under `hooks/`. */
export function bridgeBundleOptions(outdir: string): BuildOptions {
  const options = bundleOptions(OPENCODE_PLUGIN, outdir);
  const entries = options.entryPoints as { in: string; out: string }[];
  return {
    ...options,
    entryPoints: entries.map((entry) =>
      entry.in.startsWith(`${OPENCODE_PLUGIN.entriesDir}/`)
        ? { ...entry, out: `hooks/${entry.out}` }
        : entry,
    ),
  };
}

/** `dist/plugin.mjs`: ESM for OpenCode's Bun, with no banner and nothing external. */
export function pluginBundleOptions(outdir: string): BuildOptions {
  return {
    absWorkingDir: REPO_ROOT,
    entryPoints: [{ in: PLUGIN_ENTRY, out: "plugin" }],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: `node${nodeFloor()}`,
    define: { __SQUEAL_NODE_FLOOR__: JSON.stringify(nodeFloor()) },
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  };
}

/**
 * What `dist/` holds, built into `outdir`: the bridge, the CLI pair, the
 * runtimes and the plugin. Returns both builds' metafiles as one (011-141).
 */
export async function buildOpencodeDist(outdir: string): Promise<Metafile> {
  const bridge = await build({ ...bridgeBundleOptions(outdir), metafile: true });
  const plugin = await build({ ...pluginBundleOptions(outdir), metafile: true });
  copyNodeTestRuntime(outdir);
  copyObserveRuntime(outdir);
  copyPytestRuntime(outdir);
  return {
    inputs: { ...bridge.metafile.inputs, ...plugin.metafile.inputs },
    outputs: { ...bridge.metafile.outputs, ...plugin.metafile.outputs },
  };
}

/**
 * Builds the OpenCode package in `plugin.pluginDir`: its version, the launcher,
 * then `dist/`. Its `dist/` is not `buildDist`'s, so `buildPlugin` is not used,
 * and the copies are made here.
 */
export async function buildOpencodePlugin(plugin: PluginBuild = OPENCODE_PLUGIN): Promise<void> {
  writePluginVersions(plugin.pluginDir, plugin.versionedFiles);
  copyPluginTrees(plugin);
  await buildOpencodeDist(distOf(plugin));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildOpencodePlugin();
}
