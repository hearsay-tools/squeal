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
import { delimiter, join } from "node:path";
import { claudeInstalls } from "../core/daemon/version.js";
import type { CliIo } from "./main.js";
import { MARKETPLACE_NAME, PLUGIN_ID, PLUGIN_NAME } from "./plugin-id.js";
import { type HarnessId, readHarnesses } from "./setup/harnesses.js";
import { openCodePackage, packagesHome, piPackage } from "./update-packages.js";

/*
 * `squeal update`, spec 005 D3: updates the plugin in every harness that has
 * it, through the harness's own CLI, so Claude Code (no auto-update for the
 * hub by default) and Codex (which upgrades at each session start) hold one
 * version and their daemons stop taking turns over one store. Pi (spec 009
 * D1) has no update for a local package, so it runs the latest release's
 * `install.sh --pi` (`SQUEAL_INSTALL_SH` overrides where it is), which
 * installs that release and keeps the previous directory for open sessions.
 * OpenCode (spec 008 D1) loads the package `install.sh` links as `current`,
 * so it runs `install.sh --opencode`, which repoints the link, when OpenCode's
 * config lists it. Then it re-copies the launcher when an installed copy has a newer format.
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
      `squeal update: no harness on the PATH has ${PLUGIN_ID} installed, and neither Pi nor OpenCode has a Squeal package. Install it:\n${commands.map((c) => `  ${c}\n`).join("")}`,
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
    // Only the reloads of the harnesses updated (spec 008 lessons, defect 4(a)); Codex and OpenCode have none.
    const reloads = [
      ...(targets.some((t) => t.name.startsWith(`${NAMES["claude-code"]}:`))
        ? ["/reload-plugins in Claude Code"]
        : []),
      ...(targets.some((t) => t.name.startsWith("Pi:")) ? ["/reload in Pi"] : []),
    ];
    const until = reloads.length > 0 ? `, or until ${reloads.join(" or ")}` : "";
    io.stdout(`A running session keeps the version it loaded until it restarts${until}.\n`);
  }
  return ok ? 0 : 1;
}

/** Claude Code and Codex when on the PATH with the plugin, then Pi and OpenCode when on the PATH with a package. */
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
      update: () => runInstallSh("--pi", cwd, env, io),
      versionAfter: () => piPackage(env)?.version ?? null,
    });
  }
  const openCode = openCodePackage(env);
  if (onPath("opencode", env) && openCode !== null) {
    targets.push({
      name: "OpenCode: Squeal",
      version: openCode.version,
      update: () => runInstallSh("--opencode", cwd, env, io),
      versionAfter: () => openCodePackage(env)?.version ?? null,
    });
  }
  return targets;
}

/** Downloads the latest release's `install.sh` and runs its step `flag`; the script is deleted after. */
function runInstallSh(flag: string, cwd: string, env: Env, io: CliIo): boolean {
  const dir = mkdtempSync(join(tmpdir(), "squeal-update-"));
  try {
    const script = join(dir, "install.sh");
    const url = env.SQUEAL_INSTALL_SH ?? LATEST_INSTALL_SH;
    return (
      run(["curl", "-fsSL", "-o", script, url], cwd, env, io) &&
      run(["sh", script, flag], cwd, env, io)
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

/** Every installed plugin directory: each Claude Code entry, each Codex cache version, each Pi and OpenCode package. */
function pluginDirs(env: Env): string[] {
  const home = env.HOME ?? "";
  const dirs: string[] = [];
  const config = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  for (const { installPath } of claudeInstalls(join(config, "plugins"), MARKETPLACE_NAME))
    if (installPath !== null) dirs.push(installPath);
  const cache = join(
    env.CODEX_HOME ?? join(home, ".codex"),
    "plugins",
    "cache",
    MARKETPLACE_NAME,
    PLUGIN_NAME,
  );
  if (existsSync(cache)) for (const version of readdirSync(cache)) dirs.push(join(cache, version));
  for (const packages of [packagesHome("pi", env), packagesHome("opencode", env)]) {
    if (existsSync(packages))
      for (const version of readdirSync(packages)) dirs.push(join(packages, version));
  }
  return dirs;
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
