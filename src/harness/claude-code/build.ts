import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build } from "esbuild";

/*
 * Bundles every hook entry point and the CLI into one file each under
 * plugins/claude-code/dist/ (spec 001 D9: hook scripts are dependency-free).
 * Run by `npm run build`; self-contained so Node runs it with type stripping.
 */

/** Repository root: this file is src/harness/claude-code/build.ts. */
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const PLUGIN_DIST = join(REPO_ROOT, "plugins/claude-code/dist");

/** Hook bundle names: one per file in src/harness/claude-code/entries/. */
export function hookEntries(): string[] {
  return readdirSync(join(REPO_ROOT, "src/harness/claude-code/entries"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function bundleOptions(outdir: string): BuildOptions {
  return {
    absWorkingDir: REPO_ROOT,
    entryPoints: [
      ...hookEntries().map((name) => ({
        in: `src/harness/claude-code/entries/${name}.ts`,
        out: name,
      })),
      // `bin/squeal` runs this; `squeal --version` reads ../../package.json, the plugin's.
      { in: "src/cli/index.ts", out: "cli/squeal" },
    ],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.13",
    // Runner-side packages the daemon loads from the project, never from the plugin.
    external: ["vitest", "vitest/*", "@parcel/watcher"],
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(bundleOptions(PLUGIN_DIST));
}
