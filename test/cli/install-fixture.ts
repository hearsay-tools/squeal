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
 * 005 D3): its own HOME, CLAUDE_CONFIG_DIR and CODEX_HOME, stub `claude`,
 * `codex` and `pi` first on a PATH that holds only them, a `node` link and the
 * system directories, a `file://` hub, `file://` tag archives (spec 009
 * D1) and the latest release's `install.sh` at `SQUEAL_INSTALL_SH`. No real
 * harness runs, and the real plugin's `bin/` is never on this PATH.
 */

export const LAUNCHER = join(REPO_ROOT, "plugins", "claude-code", "bin", "squeal-launcher");
export const INSTALL_SH = join(REPO_ROOT, "install.sh");

/**
 * Stub `claude`, `codex` and `pi`: each call goes to `STUB_LOG`, and each
 * command changes the scratch home the way the harness's own does, from the
 * hub's current plugin directories. `marketplace add` of a marketplace already
 * added fails; `STUB_PRIVATE` makes it fail as a hub without access does, and
 * `STUB_FAIL` fails every call that starts with it (`codex plugin`). `pi
 * install <dir>` and `pi remove <dir>` edit Pi's user settings as Pi 1.0.4
 * does: a local source relative to the agent directory, an install of a listed
 * source changes nothing, a remove of an unlisted one fails.
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
if (tool === "pi") {
  const agent = env.PI_CODING_AGENT_DIR ?? p.join(env.HOME, ".pi", "agent");
  const settings = p.join(agent, "settings.json");
  const file = readJson(settings, {});
  const packages = file.packages ?? [];
  const dir = p.resolve(args[1] ?? "");
  const listed = (s) => p.resolve(agent, s) === dir;
  if (args[0] === "install" && args.length === 2) {
    if (!fs.existsSync(p.join(dir, "package.json"))) fail("no package at " + args[1]);
    if (!packages.some(listed)) writeJson(settings, { ...file, packages: [...packages, p.relative(agent, dir) || "."] });
    console.log("Installed " + args[1]);
  } else if (args[0] === "remove" && args.length === 2) {
    if (!packages.some(listed)) fail("No matching package found for " + args[1]);
    writeJson(settings, { ...file, packages: packages.filter((s) => !listed(s)) });
    console.log("Removed " + args[1]);
  } else fail("stub: unknown command " + cmd);
  process.exit(0);
}
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

/** Writes a plugin directory as the harness installs it, or the Pi package: manifest, launcher, CLI. */
export function writePlugin(
  dir: string,
  harness: "claude-code" | "codex" | "pi",
  version: string,
  launcher = readFileSync(LAUNCHER, "utf8"),
): void {
  mkdirSync(dir, { recursive: true });
  if (harness === "pi") {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "squeal-pi", version }));
  } else {
    const manifest = harness === "claude-code" ? ".claude-plugin" : ".codex-plugin";
    mkdirSync(join(dir, manifest), { recursive: true });
    writeFileSync(join(dir, manifest, "plugin.json"), JSON.stringify({ name: "squeal", version }));
  }
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
  /** Pi's agent directory, where `pi install` writes `settings.json`. */
  readonly piAgent: string;
  readonly env: Record<string, string>;
  /** The release `install.sh` belongs to: the last `publish`. */
  readonly version: string;
  /**
   * The hub's plugins at `version` in both harnesses, the tag's source archive
   * with the Pi package, and its `install.sh` as the latest release's.
   */
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
export function machine(
  harnesses: readonly ("claude" | "codex" | "pi")[] = ["claude", "codex"],
): Machine {
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
    SQUEAL_SOURCE: `file://${join(hub, "archive")}`,
    SQUEAL_INSTALL_SH: `file://${join(hub, "releases", "latest", "install.sh")}`,
    STUB_LOG: log,
  };
  let version = "";
  return {
    root,
    home,
    claudeConfig,
    codexHome,
    hub,
    piAgent: join(home, ".pi", "agent"),
    env,
    get version() {
      return version;
    },
    publish(v, launcher) {
      version = v;
      rmSync(join(hub, "plugins"), { recursive: true, force: true });
      writePlugin(join(hub, "plugins", "claude-code"), "claude-code", v, launcher);
      writePlugin(join(hub, "plugins", "codex"), "codex", v, launcher);
      writeArchive(join(hub, "archive"), v, launcher);
      mkdirSync(join(hub, "releases", "latest"), { recursive: true });
      writeFileSync(join(hub, "releases", "latest", "install.sh"), scriptOf(v));
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

/**
 * The tag's source archive as GitHub serves it: one top directory, here named
 * as GitHub names it for `squeal--v<version>`, holding the repository, of which
 * only `plugins/pi/` is written.
 */
function writeArchive(dir: string, version: string, launcher?: string): void {
  const staging = join(dir, `staging-${version}`);
  const top = `squeal-squeal-v${version}`;
  writePlugin(join(staging, top, "plugins", "pi"), "pi", version, launcher);
  const r = spawnSync("tar", ["-czf", join(dir, `squeal--v${version}.tar.gz`), "-C", staging, top]);
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  rmSync(staging, { recursive: true });
}

/** `install.sh` as the release `version` ships it. */
export function scriptOf(version: string): string {
  const script = readFileSync(INSTALL_SH, "utf8");
  return version === ""
    ? script
    : script.replace(/^SQUEAL_VERSION=.*$/m, `SQUEAL_VERSION=${version}`);
}

/**
 * Runs `install.sh` of the machine's release as `curl … | sh` runs it, the
 * script on stdin; `args` after `sh -s --`.
 */
export function install(m: Machine, ...args: string[]): Result {
  return m.sh(args.length === 0 ? [] : ["-s", "--", ...args], { input: scriptOf(m.version) });
}

export const launcherOf = (m: Machine): string => join(m.home, ".local", "bin", "squeal");

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

/** The record of what `install.sh` created. */
export const ownedOf = (m: Machine): string =>
  join(m.home, ".local", "state", "squeal", "installed");

/** Where `install.sh` unpacks Pi packages, one directory per version (spec 009 D1). */
export const piHomeOf = (m: Machine): string => join(m.home, ".local", "share", "squeal", "pi");

export const piDirOf = (m: Machine, version = m.version): string => join(piHomeOf(m), version);

/** The packages Pi's user settings list. */
export function piPackagesOf(m: Machine): string[] {
  return (
    JSON.parse(readFileSync(join(m.piAgent, "settings.json"), "utf8")) as { packages: string[] }
  ).packages;
}
