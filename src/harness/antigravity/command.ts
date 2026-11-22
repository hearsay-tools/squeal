import { existsSync } from "node:fs";
import { join } from "node:path";
import { shellWord } from "../../core/text.js";
import { dataLauncher, dataOfCopy } from "../shared/version-copies.js";

/**
 * How an Antigravity hook's texts name the Squeal CLI (spec 024 D1), as
 * Codex's do (`codexCommand`): the launcher in the plugin data directory once
 * it exists, `PLUGIN_DATA`'s in a hook and the one beside the copy
 * `bundleCli` runs from in a CLI the launcher ran, since `plugin install`
 * replaces the installed plugin in place. Before it exists, the installed CLI,
 * `node --disable-warning=ExperimentalWarning "<PLUGIN_ROOT>/dist/cli/squeal.mjs"`,
 * quoted for a shell; without `PLUGIN_ROOT`, the running bundle's sibling
 * `cli/squeal.mjs`, `bundleCli`.
 */
export function antigravityCommand(
  env: Readonly<Record<string, string | undefined>>,
  bundleCli: string,
): string {
  const data =
    env.PLUGIN_DATA === undefined || env.PLUGIN_DATA === ""
      ? dataOfCopy(bundleCli)
      : env.PLUGIN_DATA;
  if (data !== null && existsSync(dataLauncher(data))) return shellWord(dataLauncher(data));
  const root = env.PLUGIN_ROOT;
  const cli = root === undefined || root === "" ? bundleCli : join(root, "dist/cli/squeal.mjs");
  return `node --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}
