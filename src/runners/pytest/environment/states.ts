import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
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
  | {
      readonly state: "none";
      readonly note: string;
      /**
       * `null` for an explicitly unsupported PEP 582 layout: its stand-in
       * (task 007-59) is three commands that rewrite the project's own
       * `.pdm-python`, so the note names them and Squeal does not offer
       * them as the fix.
       */
      readonly command: string | null;
    }
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
  const cwd = projectDir(root, project);
  const where = displayDir(root, cwd);
  if (discovery.kind === "none") {
    if (pdmDisablesVenv(cwd)) {
      return { state: "none", command: null, note: pep582Note(root, project, discovery, where) };
    }
    return {
      state: "none",
      command: discovery.command,
      note: `pytest project "${project.name}": no Python environment (looked at ${discovery.looked.map((path) => displayDir(root, path)).join(", ")}), so Squeal runs none of its tests and inherits none of their results. ${create(discovery, where)}: Squeal then inherits the results other worktrees recorded for the same code and environment, and runs the rest.`,
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

/** Only an explicit local PDM setting proves that virtual environments are disabled. */
function pdmDisablesVenv(cwd: AbsolutePath): boolean {
  const text = readOptional(join(cwd, "pdm.toml"));
  if (text === null) return false;
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch {
    // Malformed metadata cannot prove PEP 582 use; keep the ordinary no-environment note.
    return false;
  }
  return isRecord(doc.python) && doc.python.use_venv === false;
}

/**
 * Task 007-59, review 0.1.376 B1 and B2: the PEP 582 refusal and the
 * stand-in that works today. `PDM_VENV_IN_PROJECT=true pdm venv create`
 * makes `<cwd>/.venv` whatever `venv.in_project` says, and `pdm use --venv
 * in-project` selects it, where `pdm use -f` takes a virtual environment
 * already on `PATH`. A plain `pdm run` keeps PEP 582: it runs that Python
 * but imports from `__pypackages__`. A missing declared `python` is still
 * what discovery looks for, so the note says it must change too.
 */
function pep582Note(
  root: AbsolutePath,
  project: PytestProject,
  discovery: Extract<Discovery, { kind: "none" }>,
  where: string,
): string {
  const toml = displayDir(root, join(projectDir(root, project), "pdm.toml"));
  const looked = discovery.looked.map((path) => displayDir(root, path)).join(", ");
  const missing =
    project.python === undefined
      ? "no supported Python environment was found"
      : `the project's \`python\` in squeal.config.json, ${looked}, does not exist`;
  const head = `pytest project "${project.name}": ${toml} sets \`python.use_venv = false\`. Squeal does not support PEP 582 (\`__pypackages__\`), and ${missing}, so Squeal runs none of its tests and inherits none of their results.`;
  const steps = `run \`PDM_VENV_IN_PROJECT=true pdm venv create\`, then \`PDM_USE_VENV=true pdm use --venv in-project\`, then \`PDM_USE_VENV=true pdm install\`, in ${where}. They create \`.venv\` there, whatever PDM's \`venv.in_project\` says, install into it and leave \`pdm.toml\` unchanged. \`pdm use\` rewrites \`.pdm-python\` to name that \`.venv\` and, by default, writes \`.python-version\`. A later plain \`pdm run\` there still imports from \`__pypackages__\`; \`PDM_USE_VENV=true pdm run\` uses the \`.venv\`.`;
  if (project.python === undefined) {
    return `${head} To get one today, ${steps} Squeal then checks that environment as usual before it runs tests or inherits results.`;
  }
  return `${head} Create that environment, or set \`python\` to \`.venv/bin/python\` once ${where} has a \`.venv\`: the PDM commands alone are not enough while \`python\` names the missing path. To create the \`.venv\`, ${steps} Squeal then checks the environment \`python\` names as usual before it runs tests or inherits results.`;
}

/**
 * D2's no-environment instruction, the clause before what installing buys
 * (task 007-44, open question 1): the command a lockfile or requirements
 * file names, else a new environment the project's own install fills
 * (task 007-39, lessons.md defect 9).
 */
function create(discovery: Extract<Discovery, { kind: "none" }>, where: string): string {
  if (discovery.from !== null) return `Run \`${discovery.command}\` in ${where} to create one`;
  const venv = discovery.command.slice("python -m venv ".length);
  return `No lockfile or requirements file names an install, so create \`${venv}\` in ${where} with the project's own install (\`${discovery.command}\`, then its documented \`pip install\` into \`${venv}/bin/pip\`)`;
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
  const found: OutsideEditable[] = [];
  for (const name of listOptional(site)) {
    if (!name.endsWith(".dist-info")) continue;
    const named = editableDir(readOptional(join(site, name, "direct_url.json")));
    if (named === null || insideWorktree(root, named)) continue;
    found.push({
      distribution: name.slice(0, -".dist-info".length).split("-")[0] as string,
      path: realOr(named),
    });
  }
  return found;
}

/**
 * Whether an editable's project directory lies inside `root`, as given or
 * as its real path. Python follows symlinks, so an in-tree link to another
 * tree is outside.
 */
export function insideWorktree(root: AbsolutePath, dir: AbsolutePath): boolean {
  const path = realOr(dir);
  return [root, realOr(root)].some((r) => path === r || toRelative(r, path) !== null);
}

/** PEP 610: the local directory of an editable `direct_url.json`, else `null`. */
export function editableDir(text: string | null): AbsolutePath | null {
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
