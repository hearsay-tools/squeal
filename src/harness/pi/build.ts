import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin, LAUNCHER_COPY, type PluginBuild, REPO_ROOT } from "../build.js";

/*
 * The Pi package's build, on the shared one in src/harness/build.ts (spec 009
 * D1): `dist/extension.mjs` and its `dist/worker.mjs` beside the CLI, the
 * daemon and the runtime files, the root version in the package's
 * `package.json`, and the skill copied from the Claude Code plugin with one
 * line for Pi (`PI_SKILL_NOTE`), as is the launcher (005-76). Run by
 * `npm run build:plugin`.
 */

export const PI_PLUGIN_DIR = join(REPO_ROOT, "plugins/pi");
export const PI_PLUGIN_DIST = join(PI_PLUGIN_DIR, "dist");
/** D1: the skill's source, and where the build copies it in the Pi package. */
export const SKILL_SOURCE = "plugins/claude-code/skills/squeal";
export const PI_SKILL = "skills/squeal";

export const PI_PLUGIN: PluginBuild = {
  pluginDir: PI_PLUGIN_DIR,
  entriesDir: "src/harness/pi/entries",
  versionedFiles: ["package.json"],
  copies: [{ from: SKILL_SOURCE, to: PI_SKILL }, LAUNCHER_COPY],
};

/**
 * The line the Pi copy of the skill adds after its title (D7): a Pi package
 * puts nothing on the PATH, so the skill's `squeal` examples run as the
 * command the primer names, as in the Codex copy (002 D1 as amended).
 */
export const PI_SKILL_NOTE =
  'Under Pi `squeal` is not on the PATH: wherever this skill and its references say `squeal`, run the command the SQUEAL primer names, the Node that runs Pi with `--disable-warning=ExperimentalWarning "<package root>/dist/cli/squeal.mjs"`, the package root being the directory that holds `skills/squeal/`. The last line of a FAIL report names it too.';

const SKILL_TITLE = "# Squeal\n";

/** Inserts `PI_SKILL_NOTE` after the title of the copy's `SKILL.md`. */
export function notePiCommand(skillDir: string): void {
  const path = join(skillDir, "SKILL.md");
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(SKILL_TITLE);
  if (at < 0) throw new Error(`squeal build: ${path} has no "${SKILL_TITLE.trim()}" title`);
  const after = at + SKILL_TITLE.length;
  writeFileSync(path, `${text.slice(0, after)}\n${PI_SKILL_NOTE}\n${text.slice(after)}`);
}

/** Builds the Pi package in `plugin.pluginDir`: the shared build, then the skill note. */
export async function buildPiPlugin(plugin: PluginBuild = PI_PLUGIN): Promise<void> {
  await buildPlugin(plugin);
  if ((plugin.copies ?? []).some((c) => c.to === PI_SKILL)) {
    notePiCommand(join(plugin.pluginDir, PI_SKILL));
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPiPlugin();
}
