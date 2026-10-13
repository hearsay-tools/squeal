import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "../harness/bundle-helpers.js";

/*
 * A scratch machine for `install.sh`, the launcher and `squeal update` (spec
 * 005 D3): its own HOME, CLAUDE_CONFIG_DIR and CODEX_HOME, stub `claude` and
 * `codex` first on a PATH that holds only them, a `node` link and the system
 * directories, and a `file://` hub. No real harness runs, and the real
 * plugin's `bin/` is never on this PATH.
 */

export const LAUNCHER = join(REPO_ROOT, "plugins", "claude-code", "bin", "squeal-launcher");
export const INSTALL_SH = join(REPO_ROOT, "install.sh");

/**
 * Stub `claude` and `codex`: each call goes to `STUB_LOG`, and each command
 * changes the scratch home the way the harness's own does, from the hub's
 * current plugin directories. `marketplace add` of a marketplace already added
 * fails; `STUB_PRIVATE` makes it fail as a hub without access does, and
 * `STUB_FAIL` fails every call that starts with it (`codex plugin`).
 */
const STUB = `#!${process.execPath}
const fs = require("node:fs");
const p = require("node:path");
const tool = p.basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.STUB_LOG, JSON.stringify({ tool, args }) + "\\n");
const fail = (m) => { process.stderr.write(tool + ": " + m + "\\n"); process.exit(1); };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(p.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\\n"); };
const cmd = args.join(" ");
if (env.STUB_FAIL && (tool + " " + cmd).startsWith(env.STUB_FAIL)) fail("stub failure");
const home = tool === "claude" ? p.join(env.CLAUDE_CONFIG_DIR, "plugins") : env.CODEX_HOME;
const known = p.join(home, tool === "claude" ? "known_marketplaces.json" : "stub-marketplaces.json");
const hub = () => readJson(known, {}).hearsay?.source ?? fail("marketplace hearsay is not added");
const source = () => p.join(hub(), "plugins", tool === "claude" ? "claude-code" : "codex");
const version = (dir) => readJson(p.join(dir, tool === "claude" ? ".claude-plugin" : ".codex-plugin", "plugin.json"), {}).version;
const cache = p.join(tool === "claude" ? home : p.join(home, "plugins"), "cache", "hearsay", "squeal");
const copy = () => { const v = version(source()); fs.cpSync(source(), p.join(cache, v), { recursive: true }); return v; };
if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
  if (env.STUB_PRIVATE) fail("ERROR: Repository not found.");
  if (readJson(known, {}).hearsay) fail("marketplace 'hearsay' already exists");
  writeJson(known, { hearsay: { source: args[3].replace(/^file:\\/\\//, "") } });
} else if (tool === "claude") {
  const installed = p.join(home, "installed_plugins.json");
  const file = readJson(installed, { version: 2, plugins: {} });
  const list = file.plugins["squeal@hearsay"] ?? [];
  const user = list.findIndex((e) => e.scope === "user");
  if (cmd === "plugin marketplace update hearsay") hub();
  else if (cmd === "plugin install squeal@hearsay" || cmd === "plugin update squeal@hearsay") {
    if (cmd.includes("update") && user < 0) fail("squeal@hearsay is not installed");
    const v = copy();
    const entry = { scope: "user", installPath: p.join(cache, v), version: v };
    if (user < 0) list.push(entry); else list[user] = entry;
    file.plugins["squeal@hearsay"] = list;
    writeJson(installed, file);
  } else if (cmd === "plugin uninstall squeal@hearsay") {
    if (user < 0) fail("squeal@hearsay is not installed");
    fs.rmSync(list[user].installPath, { recursive: true, force: true });
    list.splice(user, 1);
    if (list.length === 0) delete file.plugins["squeal@hearsay"];
    writeJson(installed, file);
  } else fail("stub: unknown command " + cmd);
} else {
  if (cmd === "plugin add squeal@hearsay") copy();
  else if (cmd === "plugin remove squeal@hearsay") fs.rmSync(cache, { recursive: true, force: true });
  else if (cmd === "plugin marketplace upgrade hearsay") {
    hub();
    if (fs.existsSync(cache)) { fs.rmSync(cache, { recursive: true, force: true }); copy(); }
  } else fail("stub: unknown command " + cmd);
}
`;

/** A fake `dist/cli/squeal.mjs`: prints its version, harness and arguments, exits with `--exit <n>`. */
function fakeCli(version: string, harness: string): string {
  return `const args = process.argv.slice(2);
console.log(JSON.stringify({ version: "${version}", harness: "${harness}", args }));
const i = args.indexOf("--exit");
process.exit(i >= 0 ? Number(args[i + 1]) : 0);
`;
}

/** Writes a plugin directory as the harness installs it: manifest, launcher, CLI. */
export function writePlugin(
  dir: string,
  harness: "claude-code" | "codex",
  version: string,
  launcher = readFileSync(LAUNCHER, "utf8"),
): void {
  const manifest = harness === "claude-code" ? ".claude-plugin" : ".codex-plugin";
  mkdirSync(join(dir, manifest), { recursive: true });
  writeFileSync(join(dir, manifest, "plugin.json"), JSON.stringify({ name: "squeal", version }));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "squeal-launcher"), launcher);
  chmodSync(join(dir, "bin", "squeal-launcher"), 0o755);
  mkdirSync(join(dir, "dist", "cli"), { recursive: true });
  writeFileSync(join(dir, "dist", "cli", "squeal.mjs"), fakeCli(version, harness));
}

/** The launcher with its format line raised, as a later release would ship it. */
export function laterLauncher(format: number): string {
  return readFileSync(LAUNCHER, "utf8").replace(
    /^# squeal-launcher format \d+$/m,
    `# squeal-launcher format ${format}`,
  );
}

export interface Machine {
  readonly root: string;
  readonly home: string;
  readonly claudeConfig: string;
  readonly codexHome: string;
  readonly hub: string;
  readonly env: Record<string, string>;
  /** The hub's plugins at `version` in both harnesses. */
  publish(version: string, launcher?: string): void;
  /** Every stub call since the last `clearLog`. */
  calls(): string[];
  clearLog(): void;
  /** Runs a shell script with this machine's env, `input` on stdin. */
  sh(args: readonly string[], options?: { input?: string; cwd?: string }): Result;
}

export interface Result {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A scratch machine; `harnesses` names the stubs on its PATH. */
export function machine(harnesses: readonly ("claude" | "codex")[] = ["claude", "codex"]): Machine {
  const root = runtimeDir();
  const home = join(root, "home");
  const claudeConfig = join(home, ".claude");
  const codexHome = join(home, ".codex");
  const hub = join(root, "hub");
  const stubs = join(root, "stubs");
  const nodeBin = join(root, "node-bin");
  const log = join(root, "stub.log");
  for (const dir of [home, stubs, nodeBin]) mkdirSync(dir, { recursive: true });
  // Only node: the directory of process.execPath also holds the real claude and codex.
  symlinkSync(process.execPath, join(nodeBin, "node"));
  writeFileSync(join(root, "stub.js"), STUB);
  chmodSync(join(root, "stub.js"), 0o755);
  for (const name of harnesses) copyFileSync(join(root, "stub.js"), join(stubs, name));
  writeFileSync(log, "");
  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: claudeConfig,
    CODEX_HOME: codexHome,
    PATH: `${stubs}:${nodeBin}:/usr/bin:/bin`,
    SQUEAL_MARKETPLACE: `file://${hub}`,
    STUB_LOG: log,
  };
  return {
    root,
    home,
    claudeConfig,
    codexHome,
    hub,
    env,
    publish(version, launcher) {
      rmSync(join(hub, "plugins"), { recursive: true, force: true });
      writePlugin(join(hub, "plugins", "claude-code"), "claude-code", version, launcher);
      writePlugin(join(hub, "plugins", "codex"), "codex", version, launcher);
    },
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          const { tool, args } = JSON.parse(line) as { tool: string; args: string[] };
          return [tool, ...args].join(" ");
        }),
    clearLog: () => writeFileSync(log, ""),
    sh(args, options = {}) {
      const r = spawnSync("/bin/sh", args, {
        env,
        cwd: options.cwd ?? home,
        input: options.input ?? "",
        encoding: "utf8",
        timeout: 30_000,
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
  };
}

/** Every file under `dir` with its content and mode, for "a second run changed nothing". */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, name.name);
      if (name.isDirectory()) walk(path);
      else
        out[relative(dir, path)] =
          `${(statSync(path).mode & 0o777).toString(8)} ${readFileSync(path, "utf8")}`;
    }
  };
  walk(dir);
  return out;
}
