import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, toRelative } from "../../../core/fs/index.js";
import type { AbsolutePath, PytestProject } from "../../../core/types/index.js";
import { type Discovery, discoverEnvironment, projectDir } from "./discover.js";
import { listOptional, readOptional, sitePackagesDir } from "./site.js";

/** An editable install whose project lies outside the worktree. */
export interface OutsideEditable {
  /** The distribution name from its `.dist-info` directory. */
  readonly distribution: string;
  /** The project directory `direct_url.json` names, symlinks resolved when it exists. */
  readonly path: AbsolutePath;
}

/**
 * Spec 007 D2's states before a run. Every state but `ready` leaves every
 * check of the project `unknown`, stores nothing and carries one note.
 */
export type EnvironmentState =
  | { readonly state: "ready"; readonly discovery: Extract<Discovery, { kind: "found" }> }
  | { readonly state: "none"; readonly note: string; readonly command: string }
  | {
      readonly state: "editable-outside";
      readonly note: string;
      readonly editables: readonly OutsideEditable[];
    };

/**
 * D2: discovery, then the editable-outside check: "any
 * `*.dist-info/direct_url.json` with `dir_info.editable` whose `url` lies
 * outside the worktree: the environment would import another worktree's
 * code. Nothing runs, since the verdict can be wrong either way."
 */
export function environmentState(root: AbsolutePath, project: PytestProject): EnvironmentState {
  const discovery = discoverEnvironment(root, project);
  const where = displayDir(root, projectDir(root, project));
  if (discovery.kind === "none") {
    return {
      state: "none",
      command: discovery.command,
      note: `pytest project "${project.name}": no Python environment (looked at ${discovery.looked.map((path) => displayDir(root, path)).join(", ")}); run \`${discovery.command}\` in ${where} to create one. Its checks stay unknown until then.`,
    };
  }
  const editables = outsideEditables(root, discovery.env);
  if (editables.length === 0) return { state: "ready", discovery };
  const named = editables.map((e) => `"${e.distribution}" from ${e.path}`).join(", ");
  return {
    state: "editable-outside",
    editables,
    note: `pytest project "${project.name}": the environment ${displayDir(root, discovery.env)} installs ${named} editable, outside this worktree, so tests would import another worktree's code. Nothing runs until this worktree has its own environment (run \`uv sync\` or your project's install in ${where}).`,
  };
}

/**
 * D2's third state: "the environment fingerprint differs before and after a
 * run: that run stores nothing and the batch is recomputed". The note, or
 * `null` when the fingerprints match.
 */
export function syncNote(project: PytestProject, before: string, after: string): string | null {
  if (before === after) return null;
  return `pytest project "${project.name}": the Python environment changed during the run (a sync or install in progress); its results are dropped and the files run again.`;
}

/** Every editable install of `env` whose `direct_url.json` names a directory outside `root`. */
export function outsideEditables(
  root: AbsolutePath,
  env: AbsolutePath,
): readonly OutsideEditable[] {
  const site = sitePackagesDir(env);
  if (site === null) return [];
  const roots = [root, realOr(root)];
  const found: OutsideEditable[] = [];
  for (const name of listOptional(site)) {
    if (!name.endsWith(".dist-info")) continue;
    const named = editableDir(readOptional(join(site, name, "direct_url.json")));
    if (named === null) continue;
    // Python follows symlinks, so an in-tree link to another tree is outside.
    const path = realOr(named);
    if (roots.some((r) => path === r || toRelative(r, path) !== null)) continue;
    found.push({ distribution: name.slice(0, -".dist-info".length).split("-")[0] as string, path });
  }
  return found;
}

/** PEP 610: the local directory of an editable `direct_url.json`, else `null`. */
function editableDir(text: string | null): AbsolutePath | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A torn write during a sync: the fingerprint check catches the sync itself.
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.dir_info) || parsed.dir_info.editable !== true) {
    return null;
  }
  const url = parsed.url;
  if (typeof url !== "string" || !url.startsWith("file:")) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function realOr(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A directory for a note: relative to the worktree root when inside it. */
function displayDir(root: AbsolutePath, path: AbsolutePath): string {
  if (path === root) return "the worktree root";
  return toRelative(root, path) ?? path;
}
