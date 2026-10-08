import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin, type PluginBuild, REPO_ROOT } from "../build.js";

/*
 * The Codex plugin's build, on the shared one in src/harness/build.ts (spec
 * 002 D1, D5): bundles under plugins/codex/dist/, the root version in
 * `.codex-plugin/plugin.json` once it exists, and the skill copied from the
 * Claude Code plugin, where its source stays, with one line for Codex
 * (`CODEX_SKILL_NOTE`). Run by `npm run build:plugin`.
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

/**
 * The one line the Codex copy of the skill adds after its title (spec 002 D1
 * as amended, `lessons.md` defect 4): `bin/` is not on a Codex agent's PATH,
 * so its `squeal` examples run as the command the primer names. One line
 * rather than a rewrite of every `squeal ` example in four files: the copy
 * stays its source plus this line, and each example still reads as a command.
 */
export const CODEX_SKILL_NOTE =
  'Under Codex `squeal` is not on the PATH: wherever this skill and its references say `squeal`, run the command the SQUEAL primer names, `node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`, the plugin root being the directory that holds `skills/squeal/`. The last line of a FAIL report names it too.';

const SKILL_TITLE = "# Squeal\n";

/** Inserts `CODEX_SKILL_NOTE` after the title of the copy's `SKILL.md`. */
export function noteCodexCommand(skillDir: string): void {
  const path = join(skillDir, "SKILL.md");
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(SKILL_TITLE);
  if (at < 0) throw new Error(`squeal build: ${path} has no "${SKILL_TITLE.trim()}" title`);
  const after = at + SKILL_TITLE.length;
  writeFileSync(path, `${text.slice(0, after)}\n${CODEX_SKILL_NOTE}\n${text.slice(after)}`);
}

/** Builds the Codex plugin in `plugin.pluginDir`: the shared build, then the skill note. */
export async function buildCodexPlugin(plugin: PluginBuild = CODEX_PLUGIN): Promise<void> {
  await buildPlugin(plugin);
  if ((plugin.copies ?? []).some((c) => c.to === CODEX_SKILL)) {
    noteCodexCommand(join(plugin.pluginDir, CODEX_SKILL));
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildCodexPlugin();
}
