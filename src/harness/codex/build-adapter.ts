import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Metafile, type Plugin } from "esbuild";
import { LAUNCHER_COPY, LAUNCHER_SOURCE, nodeFloor, REPO_ROOT, rootVersion } from "../build.js";
import { ADAPTER_HOOKS } from "./adapter/index.js";
import { CODEX_DESCRIPTION, CODEX_MANIFEST, CODEX_PLUGIN_DIR, CODEX_RUNTIME_DIR } from "./build.js";
import { type RuntimeManifest, validateRuntimeTree } from "./runtime-release/index.js";

/*
 * Spec 002 D7, `tasks/wave-5-contract.md`: the fixed plugin's explicit
 * build, `pnpm run build:codex-adapter`, never part of the routine build.
 * The plugin keeps its committed declarations (`hooks/hooks.json`, whose ten
 * handlers and their trust hashes stay as they are), skill bridges and
 * README; this writes its manifest at the adapter's own version, one adapter
 * bundle per hook under `dist/`, `seed/`, a whole copy of a complete runtime
 * tree, and `bin/squeal-launcher`, the launcher's source as it is now: a
 * frozen copy for released updaters, which recopy the launcher from the
 * plugin root (the coordinator's decision, wave 5). Changing any of them is
 * an adapter release, which users approve again.
 */

/** The adapter's version, independent of the runtime's (D7). */
export const CODEX_ADAPTER_VERSION = "1.0.1";
/** The frozen runtime the fixed plugin carries (D7). */
export const SEED = "seed";
/** The fixed plugin's committed files: copied from `from` when the build writes elsewhere. */
export const ADAPTER_COMMITTED = [".gitignore", "README.md", "hooks", "skills"] as const;
/** What the build writes, each replaced as a whole. */
const ADAPTER_GENERATED = [".codex-plugin", "bin", "dist", SEED] as const;

export interface AdapterBuild {
  /** Where the fixed plugin is written. */
  readonly pluginDir: string;
  /** A complete runtime tree, validated, then copied whole as `seed/`. */
  readonly seed: string;
  /** Where the committed files come from; `pluginDir` itself by default. */
  readonly from?: string;
  readonly version?: string;
}

/** A built fixed plugin: its seed's manifest and the adapter bundles' metafile. */
export interface BuiltAdapter {
  readonly seed: RuntimeManifest;
  readonly metafile: Metafile;
}

/**
 * Builds the fixed plugin in `pluginDir`.
 * Throws before writing when the seed is not a complete runtime, sits inside
 * the plugin, the declarations do not name exactly the adapter's hooks, or
 * the directory holds anything a fixed plugin does not.
 */
export async function buildCodexAdapter(options: AdapterBuild): Promise<BuiltAdapter> {
  const { pluginDir, seed } = options;
  const from = options.from ?? pluginDir;
  const runtime = validateRuntimeTree(seed);
  if (!relative(pluginDir, seed).startsWith("..")) {
    throw new Error(`squeal adapter build: the seed ${seed} is inside ${pluginDir}`);
  }
  declaredHooks(from);
  const known: readonly string[] = [...ADAPTER_COMMITTED, ...ADAPTER_GENERATED];
  const stray = existsSync(pluginDir)
    ? readdirSync(pluginDir).filter((e) => !known.includes(e))
    : [];
  if (stray.length > 0) {
    throw new Error(`squeal adapter build: ${pluginDir} holds ${stray.join(", ")}`);
  }
  mkdirSync(pluginDir, { recursive: true });
  if (resolve(from) !== resolve(pluginDir)) {
    for (const entry of ADAPTER_COMMITTED) {
      rmSync(join(pluginDir, entry), { recursive: true, force: true });
      cpSync(join(from, entry), join(pluginDir, entry), { recursive: true });
    }
  }
  for (const entry of ADAPTER_GENERATED) {
    rmSync(join(pluginDir, entry), { recursive: true, force: true });
  }
  const manifest = join(pluginDir, CODEX_MANIFEST);
  mkdirSync(dirname(manifest), { recursive: true });
  const fields = {
    name: "squeal",
    version: options.version ?? CODEX_ADAPTER_VERSION,
    description: CODEX_DESCRIPTION,
  };
  writeFileSync(manifest, `${JSON.stringify(fields, null, 2)}\n`);
  const launcher = join(pluginDir, LAUNCHER_COPY.to);
  mkdirSync(dirname(launcher), { recursive: true });
  copyFileSync(join(REPO_ROOT, LAUNCHER_SOURCE), launcher);
  chmodSync(launcher, 0o755);
  const metafile = await buildAdapterDist(join(pluginDir, "dist"));
  copySeed(seed, join(pluginDir, SEED), runtime);
  const copied = validateRuntimeTree(join(pluginDir, SEED), { expectedVersion: runtime.version });
  return { seed: copied, metafile };
}

/**
 * The hook names `hooks/hooks.json` of `pluginDir` runs, in handler order,
 * each from its `dist/<name>.mjs`. Throws unless they are exactly the
 * adapter's hooks, each once: positions keep their trust (D7).
 */
export function declaredHooks(pluginDir: string): string[] {
  const file = JSON.parse(readFileSync(join(pluginDir, "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const names = Object.values(file.hooks).flatMap((groups) =>
    groups.flatMap((group) =>
      group.hooks.map((h) => /"\$\{PLUGIN_ROOT\}\/dist\/([a-z-]+)\.mjs"/.exec(h.command)?.[1]),
    ),
  );
  const expected = [...ADAPTER_HOOKS].sort();
  const found = names.map((n) => n ?? "?");
  if (JSON.stringify([...found].sort()) !== JSON.stringify(expected)) {
    throw new Error(`squeal adapter build: hooks.json runs ${found.join(", ")}, not the adapter's`);
  }
  return found;
}

const ENTRY = "squeal-adapter-hook";

/** Each `dist/<hook>.mjs` as the adapter run for that hook, from no file of its own. */
const adapterEntries: Plugin = {
  name: ENTRY,
  setup(builder) {
    builder.onResolve({ filter: new RegExp(`^${ENTRY}:`) }, (args) => ({
      path: args.path.slice(ENTRY.length + 1),
      namespace: ENTRY,
    }));
    builder.onLoad({ filter: /.*/, namespace: ENTRY }, (args) => ({
      contents: `import { runAdapterHook } from "./src/harness/codex/adapter/index.ts";\nawait runAdapterHook(${JSON.stringify(args.path)});\n`,
      resolveDir: REPO_ROOT,
      loader: "ts",
    }));
  },
};

/** Bundles one adapter entry per hook into `outdir`; returns the metafile. */
export async function buildAdapterDist(outdir: string): Promise<Metafile> {
  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: ADAPTER_HOOKS.map((hook) => ({ in: `${ENTRY}:${hook}`, out: hook })),
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: `node${nodeFloor()}`,
    plugins: [adapterEntries],
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  });
  return result.metafile;
}

/** Copies the runtime `from` to `to` with the modes its manifest lists. */
function copySeed(from: string, to: string, runtime: RuntimeManifest): void {
  cpSync(from, to, { recursive: true });
  for (const [path, { mode }] of Object.entries(runtime.files)) chmodSync(join(to, path), mode);
  chmodSync(join(to, "runtime.json"), 0o644);
}

/**
 * `pnpm run build:codex-adapter`: the fixed plugin in plugins/codex, its seed
 * the current runtime in plugins/codex-runtime, which must be the root
 * version's (build it first with `pnpm run build`).
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = validateRuntimeTree(CODEX_RUNTIME_DIR).version;
  if (version !== rootVersion()) {
    throw new Error(
      `squeal adapter build: plugins/codex-runtime is ${version}, not ${rootVersion()}; run pnpm run build first`,
    );
  }
  await buildCodexAdapter({ pluginDir: CODEX_PLUGIN_DIR, seed: CODEX_RUNTIME_DIR });
}
