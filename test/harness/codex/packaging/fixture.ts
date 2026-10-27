import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import {
  type BuiltRuntime,
  buildCodexRuntime,
  CODEX_PLUGIN_DIR,
  CODEX_RUNTIME,
  noteCodexCommand,
  SKILL_SOURCE,
} from "../../../../src/harness/codex/build.js";
import {
  type BuiltAdapter,
  buildCodexAdapter,
} from "../../../../src/harness/codex/build-adapter.js";
import { observeMetafile } from "../../../helpers/build-inputs.js";
import { tempDir } from "../../../store/helpers.js";

/*
 * Row 002-31 (spec 002 D7, D8): scratch builds of the Codex runtime and the
 * fixed plugin. No test builds into plugins/codex or plugins/codex-runtime;
 * the coordinator generates those at integration.
 */

/** Two runtime versions of one release line, A before B. */
export const A = "0.1.900";
export const B = "0.1.901";

/** A directory under /tmp for one test file's builds; `cleanup` in `afterAll`. */
export function scratch(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(`/tmp/${prefix}`);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The current runtime of `version` built into `dir`, its inputs reported as read. */
export async function runtimeAt(dir: string, version: string): Promise<BuiltRuntime> {
  const built = await buildCodexRuntime({ ...CODEX_RUNTIME, pluginDir: dir }, version);
  observeMetafile(built.metafile);
  return built;
}

/** The fixed plugin built into `dir` with `seed` as its seed, committed files from plugins/codex. */
export async function adapterAt(dir: string, seed: string): Promise<BuiltAdapter> {
  const built = await buildCodexAdapter({ pluginDir: dir, seed, from: CODEX_PLUGIN_DIR });
  observeMetafile(built.metafile);
  return built;
}

/** The skill as the Codex copy must hold it: its source with the Codex note (002 D1 as amended). */
export function expectedSkill(): string {
  const dir = join(tempDir("squeal-codex-skill-"), "squeal");
  cpSync(join(REPO_ROOT, SKILL_SOURCE), dir, { recursive: true });
  noteCodexCommand(dir);
  return dir;
}

/** Every file under `root`, relative, as `<mode> <sha256>`: what a byte-stability check compares. */
export function snapshotTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const mode = (lstatSync(path).mode & 0o777).toString(8);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    files[path.slice(root.length + 1)] = `${mode} ${hash}`;
  }
  return files;
}
