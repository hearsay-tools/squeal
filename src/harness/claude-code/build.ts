import { readdirSync, readFileSync } from "node:fs";
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

/** The root manifest's version, baked into every bundle (review wave 3, B1: one version source). */
export function rootVersion(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

export function bundleOptions(outdir: string): BuildOptions {
  return {
    absWorkingDir: REPO_ROOT,
    entryPoints: [
      ...hookEntries().map((name) => ({
        in: `src/harness/claude-code/entries/${name}.ts`,
        out: name,
      })),
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
    // Vitest and @parcel/watcher are resolved from the project at run time (B2); this keeps a
    // type-only or stray reference from pulling them in.
    external: ["vitest", "vitest/*", "@parcel/watcher"],
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(bundleOptions(PLUGIN_DIST));
}
