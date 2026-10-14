import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isMissing, toAbsolute, toRelative } from "../../../core/fs/index.js";
import type { AbsolutePath, PytestProject } from "../../../core/types/index.js";

/** How the interpreter was found (spec 007 D2's discovery order). */
export type EnvironmentSource = "declared" | "venv" | "pdm-python";

/**
 * The outcome of D2's discovery: an environment and its interpreter, or no
 * environment with the command that would create one.
 */
export type Discovery =
  | {
      readonly kind: "found";
      readonly source: EnvironmentSource;
      /** The environment directory: `VIRTUAL_ENV` of a run, the root of `bin/` and `lib/`. */
      readonly env: AbsolutePath;
      /** `<env>/bin/python`, or the declared interpreter. */
      readonly python: AbsolutePath;
    }
  | {
      readonly kind: "none";
      /** Where Squeal looked, for the note. */
      readonly looked: readonly AbsolutePath[];
      /** D2: "the command that creates one [...], chosen from the lockfile present". */
      readonly command: string;
    };

/** The project's `cwd` as an absolute path. */
export function projectDir(root: AbsolutePath, project: PytestProject): AbsolutePath {
  return project.cwd === undefined ? root : toAbsolute(root, project.cwd);
}

/**
 * Spec 007 D2: "the project's `python` if set; else `<cwd>/.venv`; else
 * `.pdm-python` when it points inside the worktree; else no environment.
 * `VIRTUAL_ENV`, `CONDA_PREFIX`, `python` on `PATH` and parent directories
 * are never consulted." Reads files only; never runs anything.
 *
 * A `.venv` counts once its `pyvenv.cfg` exists, the file a sync writes
 * first and D2 re-checks on. A `.venv` that is a link out of the worktree is
 * still found: the editable-outside state is what refuses it.
 */
export function discoverEnvironment(root: AbsolutePath, project: PytestProject): Discovery {
  const cwd = projectDir(root, project);
  if (project.python !== undefined) {
    const declared = resolve(cwd, project.python);
    if (isDirectory(declared)) return found("declared", declared, join(declared, "bin", "python"));
    if (existsSync(declared)) return found("declared", dirname(dirname(declared)), declared);
    return none(root, cwd, [declared]);
  }
  const venv = join(cwd, ".venv");
  if (existsSync(join(venv, "pyvenv.cfg"))) return found("venv", venv, join(venv, "bin", "python"));
  const pdm = pdmPython(root, cwd);
  if (pdm !== null) return found("pdm-python", dirname(dirname(pdm)), pdm);
  return none(root, cwd, [venv, join(cwd, ".pdm-python")]);
}

function found(source: EnvironmentSource, env: AbsolutePath, python: AbsolutePath): Discovery {
  return { kind: "found", source, env, python };
}

/** PDM's saved interpreter (`.pdm-python`, an absolute path), only when it lies inside the worktree. */
function pdmPython(root: AbsolutePath, cwd: AbsolutePath): AbsolutePath | null {
  let text: string;
  try {
    text = readFileSync(join(cwd, ".pdm-python"), "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!isAbsolute(text) || toRelative(root, text) === null || !existsSync(text)) return null;
  return text;
}

/** Lockfile to the command that syncs it, nearest first; D2's note names the command. */
const LOCKFILES: readonly (readonly [string, string])[] = [
  ["uv.lock", "uv sync"],
  ["poetry.lock", "poetry install"],
  ["pdm.lock", "pdm install"],
];

/**
 * No environment. The command comes from the first lockfile from `cwd` up
 * to the worktree root (a uv workspace member's lock sits at the workspace
 * root); without one, `uv sync`.
 */
function none(root: AbsolutePath, cwd: AbsolutePath, looked: readonly AbsolutePath[]): Discovery {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const hit = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (hit !== undefined) return { kind: "none", looked, command: hit[1] };
    if (toRelative(root, dir) === null) break;
  }
  return { kind: "none", looked, command: "uv sync" };
}

function isDirectory(path: AbsolutePath): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
