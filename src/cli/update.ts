import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../core/fs/index.js";
import type { CliIo } from "./main.js";
import { MARKETPLACE_NAME, PLUGIN_ID, PLUGIN_NAME } from "./plugin-id.js";
import { type HarnessId, readHarnesses } from "./setup/harnesses.js";

/*
 * `squeal update`, spec 005 D3: updates the plugin in every harness that has
 * it, through the harness's own CLI, so Claude Code (no auto-update for the
 * hub by default) and Codex (which upgrades at each session start) hold one
 * version and their daemons stop taking turns over one store. Then it
 * re-copies the launcher when the installed plugin's copy has a newer format.
 */

const NAMES: Record<HarnessId, string> = { "claude-code": "Claude Code", codex: "Codex" };

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
  const before = readHarnesses(cwd, env).filter((h) => h.onPath && h.plugin !== null);
  if (before.length === 0) {
    const commands = readHarnesses(cwd, env).flatMap((h) => h.installCommands);
    io.stderr(
      `squeal update: no harness on the PATH has ${PLUGIN_ID} installed. Install it:\n${commands.map((c) => `  ${c}\n`).join("")}`,
    );
    return 1;
  }
  const failed = new Set<HarnessId>();
  for (const harness of before) {
    if (!UPDATE_COMMANDS[harness.id].every((command) => run(command, cwd, env, io))) {
      failed.add(harness.id);
    }
  }
  let ok = failed.size === 0;
  const after = new Map(readHarnesses(cwd, env).map((h) => [h.id, h.plugin?.version ?? null]));
  for (const harness of before) {
    const was = harness.plugin?.version;
    const now = after.get(harness.id) ?? "not installed";
    const how = now !== was ? `was ${was}` : failed.has(harness.id) ? "not updated" : "up to date";
    io.stdout(`${NAMES[harness.id]}: ${PLUGIN_ID} ${now}, ${how}\n`);
  }
  const versions = new Set(before.map((h) => after.get(h.id)));
  if (versions.size > 1) {
    io.stdout("The harnesses still hold different versions; the launcher runs the newer.\n");
    ok = false;
  }
  recopyLauncher(env, io);
  if (ok) {
    io.stdout(
      "A running session keeps the version it loaded until it restarts, or until /reload-plugins in Claude Code.\n",
    );
  }
  return ok ? 0 : 1;
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

/** Every installed plugin directory: each Claude Code entry and each Codex cache version. */
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
  return dirs;
}
