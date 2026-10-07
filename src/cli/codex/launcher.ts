import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CodexHookGroup, type HooksFile, hookHashes, LAUNCHER_KEY_SOURCE } from "./hash.js";

/*
 * Spec 002 D1: a launcher that passes `thread/start` `config`, as Cezar does,
 * can declare Squeal's hooks and trust them there, with no file write and no
 * bypass flag (`research/wave-0-checks.md` 3, recommendation 3a). Hooks
 * declared there get no `PLUGIN_ROOT`, so commands name the plugin by path.
 */

const MANIFEST = join(".codex-plugin", "plugin.json");

/**
 * The Codex plugin directory nearest above `module`: the directory itself
 * when the CLI runs from the plugin's bundle, or `plugins/codex` of a
 * checkout or the npm package; `null` when there is none.
 */
export function findCodexPlugin(module: URL = new URL(import.meta.url)): string | null {
  let dir = dirname(fileURLToPath(module));
  for (;;) {
    if (existsSync(join(dir, MANIFEST))) return dir;
    const nested = join(dir, "plugins", "codex");
    if (existsSync(join(nested, MANIFEST))) return nested;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The plugin's `hooks/hooks.json`. */
export function readPluginHooks(pluginRoot: string): HooksFile {
  return JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8")) as HooksFile;
}

/**
 * The `thread/start` `config` object: `hooks.<Event>` with the plugin's
 * groups, `${PLUGIN_ROOT}` replaced by `pluginRoot`, and `hooks.state` with
 * the trust of each, keyed `/<session-flags>/config.toml:<event>:<group>:<handler>`.
 * Throws when `pluginRoot` cannot sit inside the commands' double quotes.
 */
export function launcherConfig(pluginRoot: string, hooks: HooksFile): Record<string, unknown> {
  if (/["$`\\\n]/.test(pluginRoot)) {
    throw new Error(`plugin path ${JSON.stringify(pluginRoot)} contains a shell metacharacter`);
  }
  const expanded: Record<string, readonly CodexHookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    expanded[event] = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((h) => ({
        ...h,
        command: h.command.replaceAll(`\${PLUGIN_ROOT}`, pluginRoot),
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
