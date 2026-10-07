import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin, type PluginBuild, REPO_ROOT } from "../build.js";

/*
 * The Codex plugin's build, on the shared one in src/harness/build.ts (spec
 * 002 D1, D5): bundles under plugins/codex/dist/, the root version in
 * `.codex-plugin/plugin.json` once it exists, and the skill copied from the
 * Claude Code plugin, where its source stays. Run by `npm run build:plugin`.
 */

export const CODEX_PLUGIN_DIR = join(REPO_ROOT, "plugins/codex");
export const CODEX_PLUGIN_DIST = join(CODEX_PLUGIN_DIR, "dist");
/** The manifest 002-13 creates; the Codex plugin exists once it does. */
export const CODEX_MANIFEST = ".codex-plugin/plugin.json";
/** D1: the skill's source, and where the build copies it in the Codex plugin. */
export const SKILL_SOURCE = "plugins/claude-code/skills/squeal";
export const CODEX_SKILL = "skills/squeal";

export const CODEX_PLUGIN: PluginBuild = {
  pluginDir: CODEX_PLUGIN_DIR,
  entriesDir: "src/harness/codex/entries",
  versionedFiles: [CODEX_MANIFEST],
  copies: [{ from: SKILL_SOURCE, to: CODEX_SKILL }],
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPlugin(CODEX_PLUGIN);
}
