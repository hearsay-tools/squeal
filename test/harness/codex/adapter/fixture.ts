import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import {
  listTree,
  REQUIRED_ENTRIES,
  RUNTIME_ENTRY,
  RUNTIME_MANIFEST,
} from "../../../../src/harness/codex/adapter/manifest.js";
import { observeMetafile } from "../../../helpers/build-inputs.js";
import { type BundleRun, runNode } from "../../bundle-helpers.js";

/*
 * Runtime trees, fixed plugins and the adapter's bundle for row 002-29's
 * tests (spec 002 D7 to D9). A fixture runtime's `dist/runtime.mjs` reports
 * which runtime ran and what it was given, so a test sees the selection
 * through a real hook process.
 */

/** An adapter version, independent of every runtime version (spec 002 D7). */
export const ADAPTER_VERSION = "1.0.0";

/** A Node floor every Node meets, so no test reads the Node version. */
export const ANY_NODE = "1.0.0";

export const write = (path: string, text: string | Buffer, mode = 0o644): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
};

/** What a fixture runtime prints: its version and the environment it ran in. */
export interface Ran {
  readonly version: string;
  readonly name: string;
  readonly root: string;
  readonly data: string;
  readonly adapter: string;
  readonly session: string | null;
}

/** A `dist/runtime.mjs` that prints `Ran` for `version`, side-effect free on import. */
export function reportingEntry(version: string): string {
  return `export async function runRuntimeHook(name, stdin, env) {
  let session = null;
  try { session = JSON.parse(stdin).session_id ?? null; } catch {}
  process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)}, name, root: env.PLUGIN_ROOT, data: env.PLUGIN_DATA, adapter: env.SQUEAL_ADAPTER_ROOT, session }));
}
`;
}

/**
 * A complete runtime tree of `version` at `root`: plugin manifest, required
 * entries and `runtime.json` over every file. `entry` replaces the reporting
 * `dist/runtime.mjs`.
 */
export function runtimeTree(
  root: string,
  version: string,
  entry = reportingEntry(version),
): string {
  write(
    join(root, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "squeal", version })}\n`,
  );
  for (const path of REQUIRED_ENTRIES) {
    if (path.startsWith(".codex-plugin")) continue;
    const mode = path.startsWith("bin/") ? 0o755 : 0o644;
    write(join(root, path), path === RUNTIME_ENTRY ? entry : `// ${version} ${path}\n`, mode);
  }
  write(join(root, "dist", "observe", "recorder.cjs"), `// ${version} recorder\n`);
  return writeManifest(root, version);
}

/** Writes `runtime.json` of `root` over every other file as it is now; returns `root`. */
export function writeManifest(root: string, version: string, nodeFloor = ANY_NODE): string {
  const files: Record<string, { sha256: string; mode: number }> = {};
  // `runtime.json`'s one spelling (002-30): paths sorted, 2-space JSON, a final newline.
  for (const path of listTree(root).sort()) {
    if (path === RUNTIME_MANIFEST) continue;
    const bytes = readFileSync(join(root, path));
    // A checkout under umask 002 holds 0664 and 0775: the inventory allows 0644 and 0755.
    const mode = statSync(join(root, path)).mode & 0o111 ? 0o755 : 0o644;
    chmodSync(join(root, path), mode);
    files[path] = { sha256: createHash("sha256").update(bytes).digest("hex"), mode };
  }
  write(
    join(root, RUNTIME_MANIFEST),
    `${JSON.stringify({ schema: 1, version, nodeFloor, files }, null, 2)}\n`,
  );
  return root;
}

/** A fixed plugin at `root` whose seed is a runtime tree of `seed`. */
export function fixedPlugin(root: string, seed: string): string {
  write(
    join(root, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "squeal", version: ADAPTER_VERSION })}\n`,
  );
  runtimeTree(join(root, "seed"), seed);
  return root;
}

/**
 * The adapter as a hook bundle into `dir/adapter.mjs`: `node adapter.mjs
 * <hook name>`, stdin the hook input. Packaging decides the real entry
 * files; this is test output only.
 */
export async function buildAdapter(dir: string): Promise<string> {
  const outfile = join(dir, "adapter.mjs");
  const result = await build({
    stdin: {
      contents: `import { runAdapterHook } from "./src/harness/codex/adapter/index.ts";\nawait runAdapterHook(process.argv[2] ?? "");\n`,
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "warning",
    metafile: true,
  });
  observeMetafile(result.metafile);
  return outfile;
}

/** Runs the adapter bundle as Codex runs a hook: its own process, stdin piped. */
export function runAdapter(
  adapter: string,
  name: string,
  input: object | string,
  env: Readonly<Record<string, string>>,
): Promise<BundleRun> {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  return runNode(["--disable-warning=ExperimentalWarning", adapter, name], stdin, env);
}
