import { existsSync } from "node:fs";
import {
  ANTIGRAVITY_BIN_ENV,
  ANTIGRAVITY_DISABLED,
  antigravityCli,
  antigravityPlugin,
  antigravityPluginDir,
} from "./install.js";

/*
 * Spec 024 D1, `squeal update` in Antigravity: `agy plugin install` replaces
 * the installed plugin in place, so the update runs the latest release's
 * `install.sh --antigravity` when the CLI passes detection and the plugin is
 * installed. A plugin directory without such a CLI cannot be updated, which
 * `research/wave-0-checks.md` 1 found on a host that has only Squawk's copy.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** What `squeal update` does for Antigravity. */
export type AntigravityUpdate =
  /** Neither the plugin nor its directory: nothing to update or say. */
  | { readonly state: "absent" }
  /** Update through `install.sh --antigravity`; `note` when Antigravity has the plugin disabled. */
  | { readonly state: "ready"; readonly version: string; readonly note: string | null }
  /** The plugin directory is there, but it cannot be updated: `problem` says why and what to do. */
  | { readonly state: "blocked"; readonly problem: string };

export function antigravityUpdate(env: Env): AntigravityUpdate {
  const dir = antigravityPluginDir(env);
  if (!existsSync(dir)) return { state: "absent" };
  const plugin = antigravityPlugin(env);
  if (plugin === null) {
    return {
      state: "blocked",
      problem: `${dir} holds no plugin.json with a version; reinstall Squeal with install.sh --antigravity`,
    };
  }
  if (antigravityCli(env) === null) {
    return {
      state: "blocked",
      problem: `Antigravity has the Squeal plugin ${plugin.version} in ${dir}, but no Antigravity CLI was found: neither agy nor antigravity on the PATH prints a version and lists plugin uninstall and validate. Set ${ANTIGRAVITY_BIN_ENV} to the CLI's path and run squeal update again`,
    };
  }
  const note = plugin.disabled ? `Antigravity: ${ANTIGRAVITY_DISABLED}` : null;
  return { state: "ready", version: plugin.version, note };
}

/** The installed plugin's version after an update, `null` when none is installed. */
export function antigravityVersion(env: Env): string | null {
  return antigravityPlugin(env)?.version ?? null;
}
