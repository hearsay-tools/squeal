import { existsSync } from "node:fs";
import { join } from "node:path";
import { shellWord } from "../../core/text.js";
import { dataLauncher, dataOfCopy } from "../shared/version-copies.js";

/**
 * How a Codex hook's texts name the Squeal CLI (spec 002 D1 as amended,
 * `lessons.md` defect 4): `bin/` is not on a Codex agent's PATH, so a CLI by
 * its absolute path. Spec 005 D3 as amended 2026-10-21: the launcher in the
 * plugin data directory once it exists, since Codex's install of another
 * version deletes this one's cache directory; it is `PLUGIN_DATA`'s in a
 * hook, and the one beside the copy `bundleCli` runs from in a CLI the
 * launcher ran. Before it exists, the installed CLI,
 * `node --disable-warning=ExperimentalWarning "<PLUGIN_ROOT>/dist/cli/squeal.mjs"`,
 * quoted for a shell; the flag keeps `node:sqlite`'s warning off the agent's
 * stderr on Node 22, as `plugins/claude-code/bin/squeal` does. Hooks a launcher declares get no `PLUGIN_ROOT`
 * (`research/wave-0-checks.md` 2), so without one the running bundle's
 * sibling `cli/squeal.mjs`, `bundleCli`, is named instead.
 */
export function codexCommand(
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
