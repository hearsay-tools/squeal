import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { type BuildOptions, build } from "esbuild";

/*
 * Builds one harness plugin (spec 001 D9, spec 002 D5): every hook entry point
 * and the CLI pair bundled into one file each under `<plugin>/dist/` (hook
 * scripts are dependency-free), the node:test runtime files beside them, the
 * root version written into the plugin's manifests (001-76), and the trees a
 * plugin carries copied in. `npm run build:plugin` builds both plugins through
 * `claude-code/build.ts` and `codex/build.ts`.
 */

/** Repository root: this file is src/harness/build.ts. */
export const REPO_ROOT = resolve(import.meta.dirname, "../..");

/**
 * Task 003-13: the node:test reporter and recorder, dependency-free `.mjs`
 * and `.cjs` files (the recorder is CommonJS, task 003-28) the bundled CLI
 * finds at `<plugin>/dist/node-test/`.
 */
export const NODE_TEST_RUNTIME = "src/runners/node-test/runtime";

export interface PluginBuild {
  /** The plugin directory, absolute. */
  readonly pluginDir: string;
  /** Hook entry sources, relative to the repository root: one bundle per `.ts` file. */
  readonly entriesDir: string;
  /** Plugin files that carry the root version, relative to `pluginDir`; a missing one is skipped. */
  readonly versionedFiles: readonly string[];
  /** Trees copied whole into the plugin, `from` relative to the root, `to` to `pluginDir`. */
  readonly copies?: readonly { readonly from: string; readonly to: string }[];
}

/** The plugin's `dist/`, where its committed bundles live. */
export function distOf(plugin: PluginBuild): string {
  return join(plugin.pluginDir, "dist");
}

/** Hook bundle names: one per `.ts` file in `plugin.entriesDir`. */
export function hookEntries(plugin: PluginBuild): string[] {
  return readdirSync(join(REPO_ROOT, plugin.entriesDir))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** The root manifest's version, baked into every bundle (review wave 3, B1: one version source). */
export function rootVersion(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

/**
 * Writes `version` into each of `files` under `pluginDir` that exists, keeping
 * the rest of each manifest. Claude Code updates an installed plugin only when
 * its manifest's version changes (001-76).
 */
export function writePluginVersions(
  pluginDir: string,
  files: readonly string[],
  version = rootVersion(),
): void {
  for (const file of files) {
    const path = join(pluginDir, file);
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (manifest.version === version) continue;
    writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  }
}

export function bundleOptions(plugin: PluginBuild, outdir: string): BuildOptions {
  return {
    absWorkingDir: REPO_ROOT,
    entryPoints: [
      ...hookEntries(plugin).map((name) => ({ in: `${plugin.entriesDir}/${name}.ts`, out: name })),
      // `bin/squeal` runs this; hooks spawn it as the daemon.
      { in: "src/cli/index.ts", out: "cli/squeal" },
      // The daemon's socket worker, found beside the CLI by `prepareFrontDesk`.
      { in: "src/core/daemon/front-desk.ts", out: "cli/front-desk" },
    ],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.13",
    define: { __SQUEAL_VERSION__: JSON.stringify(rootVersion()) },
    // CommonJS dependencies (enhanced-resolve) require Node builtins; ESM output has no require.
    banner: {
      js: 'import { createRequire as __squealCreateRequire } from "node:module";\nconst require = __squealCreateRequire(import.meta.url);',
    },
    // Vitest and @parcel/watcher are resolved from the project at run time (B2); this keeps a
    // type-only or stray reference from pulling them in.
    external: ["vitest", "vitest/*", "@parcel/watcher"],
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  };
}

/**
 * Copies the `.mjs` and `.cjs` files of `from`, by default `NODE_TEST_RUNTIME`, into
 * `<outdir>/node-test/`, when that source directory exists.
 */
export function copyNodeTestRuntime(
  outdir: string,
  from: string = join(REPO_ROOT, NODE_TEST_RUNTIME),
): void {
  if (!existsSync(from)) return;
  const files = readdirSync(from).filter((f) => f.endsWith(".mjs") || f.endsWith(".cjs"));
  if (files.length === 0) return;
  // Replaced as a whole, so a runtime file removed from the sources leaves no copy behind
  // (003-28 replaced recorder.mjs by recorder.cjs).
  rmSync(join(outdir, "node-test"), { recursive: true, force: true });
  mkdirSync(join(outdir, "node-test"), { recursive: true });
  for (const file of files) copyFileSync(join(from, file), join(outdir, "node-test", file));
}

/** What `dist/` holds, built into `outdir`: the bundles and the node:test runtime. */
export async function buildDist(plugin: PluginBuild, outdir: string): Promise<void> {
  await build(bundleOptions(plugin, outdir));
  copyNodeTestRuntime(outdir);
}

/** Builds `plugin` in place: versions, copied trees, then `dist/`. */
export async function buildPlugin(plugin: PluginBuild): Promise<void> {
  writePluginVersions(plugin.pluginDir, plugin.versionedFiles);
  for (const { from, to } of plugin.copies ?? []) {
    const target = join(plugin.pluginDir, to);
    rmSync(target, { recursive: true, force: true });
    cpSync(join(REPO_ROOT, from), target, { recursive: true });
  }
  await buildDist(plugin, distOf(plugin));
}
