import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentFile, pinFile, SCHEMA } from "../../src/harness/codex/adapter/layout.js";
import { REQUIRED_ENTRIES } from "../../src/harness/codex/adapter/manifest.js";
import {
  createRuntimeManifest,
  serializeRuntimeManifest,
} from "../../src/harness/codex/runtime-release/index.js";

/*
 * Spec 002 D7 to D9 on a scratch machine: the fixed Codex plugin (its
 * adapter manifest, `hooks/hooks.json` and `seed/`), whole runtime trees,
 * and the adapter's state in Codex's plugin data directory. Each runtime's
 * CLI stubs `squeal codex-runtime` (`tasks/wave-5-contract.md`) until the
 * coordinator runs the real one with this installer (row 002-35 notes).
 */

/** Squeal's data directory under a Codex home, as Codex names it to hooks as `PLUGIN_DATA`. */
export const codexDataOf = (codexHome: string): string =>
  join(codexHome, "plugins", "data", "squeal-hearsay");

/**
 * A runtime's `dist/cli/squeal.mjs`. Any command but `codex-runtime` prints
 * its version, `codex-runtime` as its harness, its arguments and its own
 * path, and exits with `--exit <n>`. `codex-runtime ensure` and `update`
 * log to `STUB_LOG` as `squeal …`, fail when the call starts with
 * `STUB_FAIL`, and change the data directory as the contract says: ensure
 * selects the seed when no complete runtime is current; update takes the
 * tree `STUB_RUNTIME_RELEASES/<tag>`, never older than the current one.
 */
export function runtimeCli(version: string): string {
  return `import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const env = process.env;
if (args[0] !== "codex-runtime") {
  console.log(JSON.stringify({ version: "${version}", harness: "codex-runtime", args, cli: process.argv[1] }));
  const i = args.indexOf("--exit");
  process.exit(i >= 0 ? Number(args[i + 1]) : 0);
}
appendFileSync(env.STUB_LOG, JSON.stringify({ tool: "squeal", args }) + "\\n");
const fail = (m) => { process.stderr.write("squeal codex-runtime " + args[1] + ": " + m + "\\n"); process.exit(1); };
if (env.STUB_FAIL && ("squeal " + args.join(" ")).startsWith(env.STUB_FAIL)) fail("stub failure");
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = flag("--plugin-root") ?? fail("--plugin-root is required");
const data = flag("--data") ?? (env.PLUGIN_DATA || join(env.CODEX_HOME ?? join(env.HOME, ".codex"), "plugins", "data", "squeal-hearsay"));
const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };
const complete = (v) => typeof v === "string" && read(join(data, "versions", v, "runtime.json"))?.version === v;
const current = () => { const v = read(join(data, "runtime", "current.json"))?.version; return complete(v) ? v : undefined; };
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const select = (from, v) => {
  if (!complete(v)) cpSync(from, join(data, "versions", v), { recursive: true });
  if (current() === v) return;
  mkdirSync(join(data, "runtime"), { recursive: true });
  writeFileSync(join(data, "runtime", "current.json.tmp"), JSON.stringify({ schema: 1, version: v }) + "\\n");
  renameSync(join(data, "runtime", "current.json.tmp"), join(data, "runtime", "current.json"));
};
if (args[1] === "ensure") {
  const seed = read(join(root, "seed", "runtime.json"))?.version;
  if (current() === undefined) {
    if (seed === undefined) fail("no usable runtime: the plugin's seed is incomplete");
    select(join(root, "seed"), seed);
  }
  console.log("Codex runtime " + current() + " is ready");
} else if (args[1] === "update") {
  const tag = flag("--tag") ?? fail("the stub needs --tag");
  const version = tag.replace(/^squeal--v/, "");
  const release = join(env.STUB_RUNTIME_RELEASES ?? "", tag);
  if (!existsSync(release)) fail("release " + tag + " has no Codex runtime assets");
  const now = current();
  if (now !== undefined && newer(now, version)) console.log("Codex runtime " + now + " is newer than " + version + "; kept");
  else { select(release, version); console.log("Codex runtime " + version + " is current"); }
} else fail("stub: unknown command");
`;
}

/** Writes a whole runtime tree at `dir`: every required entry, the stub CLI and a canonical `runtime.json`. */
export function writeRuntime(dir: string, version: string, launcher: string): void {
  for (const entry of REQUIRED_ENTRIES) {
    mkdirSync(dirname(join(dir, entry)), { recursive: true });
    writeFileSync(join(dir, entry), `// ${entry} of ${version}\n`);
  }
  writeFileSync(
    join(dir, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "squeal", version }),
  );
  writeFileSync(join(dir, "dist", "cli", "squeal.mjs"), runtimeCli(version));
  writeFileSync(join(dir, "bin", "squeal-launcher"), launcher);
  chmodSync(join(dir, "bin", "squeal-launcher"), 0o755);
  const manifest = createRuntimeManifest({ root: dir, version, nodeFloor: "22.19.0" });
  writeFileSync(join(dir, "runtime.json"), serializeRuntimeManifest(manifest));
}

/**
 * The fixed plugin as Codex installs it: its manifest names the adapter
 * version, `hooks/hooks.json` declares its hooks, `seed/` holds the seed
 * runtime. `bin/squeal-launcher` is a frozen copy of the launcher, for the
 * `squeal update` of releases before it, which copies a newer launcher format
 * only from a plugin root (coordinator, 2026-10-27). It has no CLI at its root.
 */
export function writeFixedPlugin(
  dir: string,
  adapter: string,
  seed: string,
  launcher: string,
): void {
  mkdirSync(join(dir, ".codex-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "squeal", version: adapter }),
  );
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "squeal-launcher"), launcher);
  chmodSync(join(dir, "bin", "squeal-launcher"), 0o755);
  writeRuntime(join(dir, "seed"), seed, launcher);
}

/** `runtime/current.json` naming `version`, as the adapter and the updater write it. */
export function writeCurrent(data: string, version: string): void {
  mkdirSync(dirname(currentFile(data)), { recursive: true });
  writeFileSync(currentFile(data), `${JSON.stringify({ schema: SCHEMA, version })}\n`);
}

/** The pin of `sessionId` to `version`, as the adapter writes it at a session's first hook. */
export function writePin(data: string, sessionId: string, version: string): string {
  const file = pinFile(data, sessionId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ schema: SCHEMA, sessionId, version })}\n`);
  return file;
}
