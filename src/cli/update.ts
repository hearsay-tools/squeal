import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { isRecord } from "../core/fs/index.js";
import type { CliIo } from "./main.js";
import { MARKETPLACE_NAME, PLUGIN_ID, PLUGIN_NAME } from "./plugin-id.js";
import { compareVersions, type HarnessId, readHarnesses } from "./setup/harnesses.js";

/*
 * `squeal update`, spec 005 D3: updates the plugin in every harness that has
 * it, through the harness's own CLI, so Claude Code (no auto-update for the
 * hub by default) and Codex (which upgrades at each session start) hold one
 * version and their daemons stop taking turns over one store. Pi (spec 009
 * D1) has no update for a local package, so it runs the latest release's
 * `install.sh --pi` (`SQUEAL_INSTALL_SH` overrides where it is), which
 * installs that release and keeps the previous directory for open sessions.
 * Then it re-copies the launcher when an installed copy has a newer format.
 */

const NAMES: Record<HarnessId, string> = { "claude-code": "Claude Code", codex: "Codex" };

const LATEST_INSTALL_SH =
  "https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh";

/** One harness `squeal update` updates: its name and package, version, and the update. */
interface Target {
  readonly name: string;
  readonly version: string;
  readonly update: () => boolean;
  readonly versionAfter: () => string | null;
}

const UPDATE_COMMANDS: Record<HarnessId, readonly (readonly string[])[]> = {
  "claude-code": [
    ["claude", "plugin", "marketplace", "update", MARKETPLACE_NAME],
    ["claude", "plugin", "update", PLUGIN_ID],
  ],
  codex: [["codex", "plugin", "marketplace", "upgrade", MARKETPLACE_NAME]],
};

/** A harness command can fetch a marketplace over the network. */
const COMMAND_TIMEOUT_MS = 10 * 60_000;

type Env = Readonly<Record<string, string | undefined>>;

export function updateCommand(args: readonly string[], io: CliIo): number {
  if (args.length > 0) {
    io.stderr("usage: squeal update\n");
    return 2;
  }
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const targets = updateTargets(cwd, env, io);
  if (targets.length === 0) {
    const commands = [
      ...readHarnesses(cwd, env).flatMap((h) => h.installCommands),
      `curl -fsSL ${LATEST_INSTALL_SH} | sh`,
    ];
    io.stderr(
      `squeal update: no harness on the PATH has ${PLUGIN_ID} installed, and Pi has no Squeal package. Install it:\n${commands.map((c) => `  ${c}\n`).join("")}`,
    );
    return 1;
  }
  const failed = new Set(targets.filter((t) => !t.update()));
  let ok = failed.size === 0;
  const versions = new Set<string | null>();
  for (const target of targets) {
    const now = target.versionAfter();
    versions.add(now);
    const how =
      now !== target.version
        ? `was ${target.version}`
        : failed.has(target)
          ? "not updated"
          : "up to date";
    io.stdout(`${target.name} ${now ?? "not installed"}, ${how}\n`);
  }
  if (versions.size > 1) {
    io.stdout("The harnesses still hold different versions; the launcher runs the newer.\n");
    ok = false;
  }
  recopyLauncher(env, io);
  if (ok) {
    const pi = targets.some((t) => t.name.startsWith("Pi:")) ? " or /reload in Pi" : "";
    io.stdout(
      `A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code${pi}.\n`,
    );
  }
  return ok ? 0 : 1;
}

/** Claude Code and Codex when on the PATH with the plugin, then Pi when on the PATH with a package. */
function updateTargets(cwd: string, env: Env, io: CliIo): Target[] {
  const after = () =>
    new Map(readHarnesses(cwd, env).map((h) => [h.id, h.plugin?.version ?? null]));
  const targets: Target[] = readHarnesses(cwd, env).flatMap((h) =>
    h.onPath && h.plugin !== null
      ? [
          {
            name: `${NAMES[h.id]}: ${PLUGIN_ID}`,
            version: h.plugin.version,
            update: () => UPDATE_COMMANDS[h.id].every((command) => run(command, cwd, env, io)),
            versionAfter: () => after().get(h.id) ?? null,
          },
        ]
      : [],
  );
  const pi = piPackage(env);
  if (onPath("pi", env) && pi !== null) {
    targets.push({
      name: "Pi: Squeal",
      version: pi.version,
      update: () => updatePi(cwd, env, io),
      versionAfter: () => piPackage(env)?.version ?? null,
    });
  }
  return targets;
}

/** Downloads the latest release's `install.sh` and runs its Pi step; the script is deleted after. */
function updatePi(cwd: string, env: Env, io: CliIo): boolean {
  const dir = mkdtempSync(join(tmpdir(), "squeal-update-"));
  try {
    const script = join(dir, "install.sh");
    const url = env.SQUEAL_INSTALL_SH ?? LATEST_INSTALL_SH;
    return (
      run(["curl", "-fsSL", "-o", script, url], cwd, env, io) &&
      run(["sh", script, "--pi"], cwd, env, io)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Prints the command, runs it with its output passed on, and says whether it succeeded. */
function run(command: readonly string[], cwd: string, env: Env, io: CliIo): boolean {
  const [file = "", ...args] = command;
  io.stdout(`$ ${command.join(" ")}\n`);
  const r = spawnSync(file, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (r.stdout) io.stdout(r.stdout);
  if (r.stderr) io.stderr(r.stderr);
  if (r.error !== undefined) {
    io.stderr(`squeal update: ${command.join(" ")} did not run: ${r.error.message}\n`);
    return false;
  }
  if (r.status !== 0) {
    io.stderr(`squeal update: ${command.join(" ")} exited ${r.status ?? r.signal}\n`);
    return false;
  }
  return true;
}

const FORMAT = /^# squeal-launcher format (\d+)$/m;

/** The launcher's format number, or `null` when `path` holds no launcher of Squeal's. */
function launcherFormat(path: string): number | null {
  try {
    const match = FORMAT.exec(readFileSync(path, "utf8"));
    return match === null ? null : Number(match[1]);
  } catch {
    return null;
  }
}

/**
 * Replaces the launcher `install.sh` copied when an installed plugin ships a
 * newer format. A missing file, or one that is not Squeal's launcher, is left as it is.
 */
function recopyLauncher(env: Env, io: CliIo): void {
  const target = join(env.SQUEAL_BIN_DIR ?? join(env.HOME ?? "", ".local", "bin"), "squeal");
  const current = launcherFormat(target);
  if (current === null) return;
  let newest: { path: string; format: number } | null = null;
  for (const dir of pluginDirs(env)) {
    const path = join(dir, "bin", "squeal-launcher");
    const format = launcherFormat(path);
    if (format !== null && format > (newest?.format ?? current)) newest = { path, format };
  }
  if (newest === null) return;
  copyFileSync(newest.path, target);
  chmodSync(target, 0o755);
  io.stdout(`Copied the launcher (format ${current}, now ${newest.format}) to ${target}\n`);
}

/** Every installed plugin directory: each Claude Code entry, each Codex cache version, each Pi package. */
function pluginDirs(env: Env): string[] {
  const home = env.HOME ?? "";
  const dirs: string[] = [];
  const config = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  try {
    const file: unknown = JSON.parse(
      readFileSync(join(config, "plugins", "installed_plugins.json"), "utf8"),
    );
    const entries = isRecord(file) && isRecord(file.plugins) ? file.plugins[PLUGIN_ID] : null;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (isRecord(entry) && typeof entry.installPath === "string") dirs.push(entry.installPath);
    }
  } catch {
    // No Claude Code install, or a file this version cannot read: Codex's cache may still have one.
  }
  const cache = join(
    env.CODEX_HOME ?? join(home, ".codex"),
    "plugins",
    "cache",
    MARKETPLACE_NAME,
    PLUGIN_NAME,
  );
  if (existsSync(cache)) for (const version of readdirSync(cache)) dirs.push(join(cache, version));
  const pi = piHome(env);
  if (existsSync(pi)) for (const version of readdirSync(pi)) dirs.push(join(pi, version));
  return dirs;
}

/** Where `install.sh` unpacks Pi packages, one directory per version. */
function piHome(env: Env): string {
  return join(env.XDG_DATA_HOME || join(env.HOME ?? "", ".local", "share"), "squeal", "pi");
}

/**
 * The newest Pi package of `install.sh` that Pi's user settings list: a local
 * source, relative to Pi's agent directory, under `piHome`. A Squeal package
 * installed from elsewhere is the user's, and `install.sh` would not replace it.
 */
function piPackage(env: Env): { readonly version: string } | null {
  const home = env.HOME ?? "";
  let agent = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  if (agent === "~") agent = home;
  else if (agent.startsWith("~/")) agent = join(home, agent.slice(2));
  let packages: unknown = [];
  try {
    const file: unknown = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    if (isRecord(file)) packages = file.packages;
  } catch {
    return null;
  }
  const versions: string[] = [];
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = isRecord(entry) ? entry.source : entry;
    if (typeof source !== "string" || /^(npm|git|https?|ssh):/.test(source)) continue;
    const dir = resolve(agent, source);
    if (resolve(dir, "..") !== resolve(piHome(env))) continue;
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (isRecord(manifest) && typeof manifest.version === "string")
        versions.push(manifest.version);
    } catch {
      // Listed but gone: Pi itself skips it.
    }
  }
  const newest = versions.sort(compareVersions).at(-1);
  return newest === undefined ? null : { version: newest };
}

/** Whether an executable `name` is on the PATH. */
function onPath(name: string, env: Env): boolean {
  return (env.PATH ?? "").split(delimiter).some((dir) => {
    if (dir === "") return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
