import { join } from "node:path";
import { shellWord } from "../../core/delivery/index.js";

/**
 * How a Codex hook's texts name the Squeal CLI (spec 002 D1 as amended,
 * `lessons.md` defect 4): `bin/` is not on a Codex agent's PATH, so the
 * installed CLI by its path, `node --disable-warning=ExperimentalWarning "<PLUGIN_ROOT>/dist/cli/squeal.mjs"`,
 * quoted for a shell; the flag keeps `node:sqlite`'s warning off the agent's
 * stderr on Node 22, as `plugins/claude-code/bin/squeal` does. Hooks a launcher declares get no `PLUGIN_ROOT`
 * (`research/wave-0-checks.md` 2), so without one the running bundle's
 * sibling `cli/squeal.mjs`, `bundleCli`, is named instead.
 */
export function codexCommand(
  env: Readonly<Record<string, string | undefined>>,
  bundleCli: string,
): string {
  const root = env.PLUGIN_ROOT;
  const cli = root === undefined || root === "" ? bundleCli : join(root, "dist/cli/squeal.mjs");
  return `node --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}
