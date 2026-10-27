import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexNewest } from "../../core/daemon/version.js";
import { MARKETPLACE_NAME } from "../plugin-id.js";
import { type CodexHookGroup, type HooksFile, hookHashes, LAUNCHER_KEY_SOURCE } from "./hash.js";

/*
 * Spec 002 D1: a launcher that passes `thread/start` `config`, as Cezar does,
 * can declare Squeal's hooks and trust them there, with no file write and no
 * bypass flag (`research/wave-0-checks.md` 3, recommendation 3a). Hooks
 * declared there get neither `PLUGIN_ROOT` nor `PLUGIN_DATA`, so commands
 * name the plugin by path and export both, which the fixed plugin's adapter
 * needs (D7, `tasks/wave-5-contract.md`).
 */

const MANIFEST = join(".codex-plugin", "plugin.json");
const HOOKS = join("hooks", "hooks.json");
const SEED = "seed";
type Env = Readonly<Record<string, string | undefined>>;

/**
 * True for a fixed plugin root (D7): its manifest, `hooks/hooks.json` and
 * `seed/`. A retained runtime, the seed included, has a manifest of its own
 * but neither of the others, so it is never taken for the plugin.
 */
export function isFixedPlugin(dir: string): boolean {
  return [MANIFEST, HOOKS, SEED].every((path) => existsSync(join(dir, path)));
}

/** Codex's home: `CODEX_HOME`, else `~/.codex`. */
function codexHome(env: Env): string {
  return env.CODEX_HOME !== undefined && env.CODEX_HOME !== ""
    ? env.CODEX_HOME
    : join(env.HOME ?? "", ".codex");
}

/**
 * The fixed Codex plugin for this CLI: the one at or above `module`, as when
 * the CLI runs from the plugin's seed, or `plugins/codex` of a checkout;
 * else the newest one in Codex's plugin cache under `env`'s Codex home, as
 * when the CLI runs from a retained runtime. `null` when there is none.
 */
export function findCodexPlugin(
  module: URL = new URL(import.meta.url),
  env: Env = process.env,
): string | null {
  let dir = dirname(fileURLToPath(module));
  for (;;) {
    if (isFixedPlugin(dir)) return dir;
    const nested = join(dir, "plugins", "codex");
    if (isFixedPlugin(nested)) return nested;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const plugins = join(codexHome(env), "plugins");
  const newest = codexNewest(plugins, MARKETPLACE_NAME);
  const cached =
    newest === null ? null : join(plugins, "cache", MARKETPLACE_NAME, "squeal", newest);
  return cached !== null && isFixedPlugin(cached) ? cached : null;
}

/**
 * The plugin data directory Codex names to the installed plugin's hooks:
 * `PLUGIN_DATA` when set, else `<Codex home>/plugins/data/squeal-<marketplace>`.
 */
export function codexPluginData(env: Env = process.env): string {
  if (env.PLUGIN_DATA !== undefined && env.PLUGIN_DATA !== "") return env.PLUGIN_DATA;
  return join(codexHome(env), "plugins", "data", `squeal-${MARKETPLACE_NAME}`);
}

/** The plugin's `hooks/hooks.json`. */
export function readPluginHooks(pluginRoot: string): HooksFile {
  return JSON.parse(readFileSync(join(pluginRoot, HOOKS), "utf8")) as HooksFile;
}

/** Throws when `path` cannot sit inside a command's double quotes. */
function quotable(what: string, path: string): string {
  if (/["$`\\\n]/.test(path)) {
    throw new Error(`${what} path ${JSON.stringify(path)} contains a shell metacharacter`);
  }
  return `"${path}"`;
}

/**
 * The `thread/start` `config` object: `hooks.<Event>` with the plugin's
 * groups, each command preceded by the export of `PLUGIN_ROOT` and
 * `PLUGIN_DATA` and with `${PLUGIN_ROOT}` replaced by `pluginRoot`, and
 * `hooks.state` with the trust of each, keyed
 * `/<session-flags>/config.toml:<event>:<group>:<handler>`. Throws when
 * either path cannot sit inside the commands' double quotes.
 */
export function launcherConfig(
  pluginRoot: string,
  hooks: HooksFile,
  data: string = codexPluginData(),
): Record<string, unknown> {
  const exported = `export PLUGIN_ROOT=${quotable("plugin", pluginRoot)} PLUGIN_DATA=${quotable("plugin data", data)}; `;
  const expanded: Record<string, readonly CodexHookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    expanded[event] = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((h) => ({
        ...h,
        command: `${exported}${h.command.replaceAll(`\${PLUGIN_ROOT}`, pluginRoot)}`,
      })),
    }));
  }
  const config: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(expanded)) config[`hooks.${event}`] = groups;
  config["hooks.state"] = Object.fromEntries(
    hookHashes({ hooks: expanded }, LAUNCHER_KEY_SOURCE).map(({ key, hash }) => [
      key,
      { trusted_hash: hash },
    ]),
  );
  return config;
}
