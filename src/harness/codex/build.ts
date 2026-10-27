import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Metafile } from "esbuild";
import {
  buildDist,
  copyPluginTrees,
  distOf,
  LAUNCHER_COPY,
  nodeFloor,
  type PluginBuild,
  REPO_ROOT,
  rootVersion,
} from "../build.js";
import {
  createRuntimeManifest,
  RUNTIME_MANIFEST,
  type RuntimeManifest,
  serializeRuntimeManifest,
} from "./runtime-release/index.js";

/*
 * The Codex runtime's routine build, on the shared one in src/harness/build.ts
 * (spec 002 D5, D7 and D8, `tasks/wave-5-contract.md`): the current runtime
 * tree in plugins/codex-runtime/, the artifact a release packs. Its bundles
 * and `dist/runtime.mjs`, the skills copied from the Claude Code plugin, where
 * their source stays, with one line for Codex (`CODEX_SKILL_NOTE`), the
 * launcher (005-76), the manifest at the root version and `runtime.json` over
 * every other file. The fixed plugin in plugins/codex/ is never written here:
 * `build-adapter.ts` builds it, only when asked. Run by `pnpm run build:plugin`.
 */

/** The fixed plugin Codex installs: hooks, adapter, skill bridges and seed (D7). */
export const CODEX_PLUGIN_DIR = join(REPO_ROOT, "plugins/codex");
/** The current runtime tree, committed, which a release packs (D8). */
export const CODEX_RUNTIME_DIR = join(REPO_ROOT, "plugins/codex-runtime");
export const CODEX_RUNTIME_DIST = join(CODEX_RUNTIME_DIR, "dist");
/** Both trees' plugin manifest. */
export const CODEX_MANIFEST = ".codex-plugin/plugin.json";
/** D1: the skills' sources, and where the build copies them in the runtime. */
export const SKILL_SOURCE = "plugins/claude-code/skills/squeal";
export const SETUP_SKILL_SOURCE = "plugins/claude-code/skills/setup";
export const CODEX_SKILL = "skills/squeal";
export const CODEX_SETUP_SKILL = "skills/setup";
/** What the runtime's manifest says besides its name and version. */
export const CODEX_DESCRIPTION =
  "Continuous validation for coding agents: test transitions at tool boundaries, honest status on demand.";

export const CODEX_RUNTIME: PluginBuild = {
  pluginDir: CODEX_RUNTIME_DIR,
  entriesDir: "src/harness/codex/entries",
  versionedFiles: [CODEX_MANIFEST],
  copies: [
    { from: SKILL_SOURCE, to: CODEX_SKILL },
    { from: SETUP_SKILL_SOURCE, to: CODEX_SETUP_SKILL },
    LAUNCHER_COPY,
  ],
  // The fixed plugin's adapter imports it and runs the session's hook (002-29).
  entries: [{ in: "src/harness/codex/runtime-entry.ts", out: "runtime" }],
};

/**
 * The one line the Codex copy of the skill adds after its title (spec 002 D1
 * as amended, `lessons.md` defect 4): `bin/` is not on a Codex agent's PATH,
 * so its `squeal` examples run as the command the primer names. One line
 * rather than a rewrite of every `squeal ` example in four files: the copy
 * stays its source plus this line, and each example still reads as a command.
 * Spec 005 D3 as amended 2026-10-21: that command is the launcher in the
 * plugin data directory once Squeal keeps its copies there, and the line
 * names this version's copy of the skill, which a plugin update leaves.
 */
export const CODEX_SKILL_NOTE =
  'Under Codex `squeal` is not on the PATH: wherever this skill and its references say `squeal`, run the command the SQUEAL primer names. That is the launcher `<plugin data>/bin/squeal`, in the plugin data directory where Squeal keeps a copy of each version; before the first copy, it is `node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`, the plugin root being the directory that holds `skills/squeal/`. The last line of a FAIL report names it too. A plugin update deletes the plugin root of the version a session started on; this skill stays readable at `<plugin data>/versions/<version>/skills/squeal/`, the path the SessionStart message names.';

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

/** `runtime.json`'s Node floor, `major.minor.patch` (002-30): `engines.node`'s with `.0`. */
export function runtimeNodeFloor(): string {
  return `${nodeFloor()}.0`;
}

/** What only the fixed plugin holds: a runtime build refuses a directory with either. */
const FIXED_MARKS = ["seed", "hooks"] as const;
/** What a runtime build writes; each is replaced as a whole. */
const GENERATED = [".codex-plugin", "dist", "skills", "bin", RUNTIME_MANIFEST] as const;

/** A built runtime: its manifest, and the bundles' metafile a test reports as read (011-141). */
export interface BuiltRuntime {
  readonly runtime: RuntimeManifest;
  readonly metafile: Metafile;
}

/**
 * Builds the current runtime of `version` in `plugin.pluginDir`, replacing
 * every file it generates, and writes `runtime.json` over the result. Throws
 * before writing anything when the directory holds a fixed plugin's `seed/`
 * or `hooks/`, so a routine build can never rewrite the fixed plugin.
 */
export async function buildCodexRuntime(
  plugin: PluginBuild = CODEX_RUNTIME,
  version: string = rootVersion(),
): Promise<BuiltRuntime> {
  const root = plugin.pluginDir;
  const mark = FIXED_MARKS.find((name) => existsSync(join(root, name)));
  if (mark !== undefined) {
    throw new Error(`squeal build: ${root} holds ${mark}/, a fixed plugin; refusing to rebuild it`);
  }
  for (const name of GENERATED) rmSync(join(root, name), { recursive: true, force: true });
  const manifest = join(root, CODEX_MANIFEST);
  mkdirSync(dirname(manifest), { recursive: true });
  const fields = { name: "squeal", version, description: CODEX_DESCRIPTION };
  writeFileSync(manifest, `${JSON.stringify(fields, null, 2)}\n`);
  copyPluginTrees(plugin);
  if ((plugin.copies ?? []).some((c) => c.to === CODEX_SKILL)) {
    noteCodexCommand(join(root, CODEX_SKILL));
  }
  const metafile = await buildDist(plugin, distOf(plugin), version);
  const runtime = createRuntimeManifest({ root, version, nodeFloor: runtimeNodeFloor() });
  writeFileSync(join(root, RUNTIME_MANIFEST), serializeRuntimeManifest(runtime));
  return { runtime, metafile };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildCodexRuntime();
}
