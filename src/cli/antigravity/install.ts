import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { INSTALL_SH_COMMAND } from "../pi/status.js";

/*
 * Spec 024 D1 and D6, `research/wave-0-checks.md` 1 and 2: the Antigravity
 * CLI that `install.sh` and `squeal update` drive, and the plugin it
 * installed. Squeal reads Antigravity's files and never writes under
 * `~/.gemini/config/`.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The variable that names the Antigravity CLI where neither `agy` nor `antigravity` is on the PATH. */
export const ANTIGRAVITY_BIN_ENV = "SQUEAL_ANTIGRAVITY_BIN";

/**
 * The command `squeal status` and `squeal init` name to install the plugin
 * (D6): `install.sh --antigravity`, which runs `agy plugin install` on the
 * release's `plugins/antigravity/` (D1).
 */
export const ANTIGRAVITY_INSTALL_COMMAND = `${INSTALL_SH_COMMAND} -s -- --antigravity`;

/** The plugin's directory name in Antigravity's config, its `plugin.json` `name`. */
const PLUGIN_DIR_NAME = "squeal";

/** `--version` prints a bare semver; the IDE launcher prints something else (wave 0, 1). */
const BARE_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
/** A probe of a candidate never waits on a hung binary for long. */
const PROBE_TIMEOUT_MS = 5_000;

/** `~/.gemini/config/plugins/squeal`: where `agy plugin install` puts the plugin. */
export function antigravityPluginDir(env: Env): string {
  return join(env.HOME ?? "", ".gemini", "config", "plugins", PLUGIN_DIR_NAME);
}

/** `~/.gemini/antigravity-cli/plugin_data/squeal`: the plugin's `PLUGIN_DATA` outside a hook. */
export function antigravityDataDir(env: Env): string {
  return join(env.HOME ?? "", ".gemini", "antigravity-cli", "plugin_data", PLUGIN_DIR_NAME);
}

/** Runs `file args` and returns its stdout and stderr together; `null` when it does not run or exits non-zero. */
export type Probe = (file: string, args: readonly string[], env: Env) => string | null;

const spawnProbe: Probe = (file, args, env) => {
  const r = spawnSync(file, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PROBE_TIMEOUT_MS,
  });
  if (r.error !== undefined || r.status !== 0) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

/**
 * The Antigravity CLI: `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then
 * `antigravity` on the PATH, the first whose `--version` prints a bare
 * semver and whose `help plugin` lists `uninstall` and `validate`, which an
 * IDE launcher named `antigravity` does not. `null` when none passes.
 */
export function antigravityCli(env: Env, probe: Probe = spawnProbe): string | null {
  const given = env[ANTIGRAVITY_BIN_ENV];
  const candidates = [
    ...(given === undefined || given === "" ? [] : [given]),
    ...["agy", "antigravity"].flatMap((name) => onPath(name, env) ?? []),
  ];
  return candidates.find((cli) => isAntigravityCli(cli, env, probe)) ?? null;
}

function isAntigravityCli(cli: string, env: Env, probe: Probe): boolean {
  const version = probe(cli, ["--version"], env);
  if (version === null || !BARE_SEMVER.test(version.trim())) return false;
  const help = probe(cli, ["help", "plugin"], env);
  return help !== null && /\buninstall\b/.test(help) && /\bvalidate\b/.test(help);
}

/** The executable `name` in the first PATH directory that has one; `null` when none does. */
function onPath(name: string, env: Env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/** The installed plugin, as its `plugin.json` names it, and whether Antigravity has it disabled. */
export interface AntigravityPlugin {
  readonly version: string;
  readonly disabled: boolean;
}

/**
 * The plugin `agy plugin install` put in `~/.gemini/config/plugins/squeal/`;
 * `null` when its `plugin.json` is missing or names no version. Disabled
 * when `~/.gemini/config/config.json` has `plugins.squeal.enabled: false`;
 * with no entry there, when `plugin.json` declares `disabled: true` (wave 0, 2).
 */
export function antigravityPlugin(env: Env): AntigravityPlugin | null {
  const manifest = readJson(join(antigravityPluginDir(env), "plugin.json"));
  const version = manifest?.version;
  if (typeof version !== "string" || version === "") return null;
  const config = readJson(join(env.HOME ?? "", ".gemini", "config", "config.json"));
  const entry = objectOf(objectOf(config?.plugins)?.[PLUGIN_DIR_NAME]);
  const enabled = entry?.enabled;
  const disabled = typeof enabled === "boolean" ? !enabled : manifest?.disabled === true;
  return { version, disabled };
}

/** Whether the plugin directory exists, with or without a readable manifest. */
export function antigravityPluginPresent(env: Env): boolean {
  return existsSync(antigravityPluginDir(env));
}

/** The sentence that names where the plugin is disabled, for status, setup and update. */
export const ANTIGRAVITY_DISABLED =
  "the Squeal plugin is disabled in ~/.gemini/config/config.json (agy plugin enable squeal enables it)";

function readJson(path: string): Record<string, unknown> | null {
  try {
    return objectOf(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
