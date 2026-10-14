import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import { compare, toRelative } from "../../../core/fs/index.js";
import type { AbsolutePath, PytestProject } from "../../../core/types/index.js";
import type { PytestConfigFile } from "./config.js";
import type { EnvironmentFiles } from "./fingerprint.js";
import type { InterpreterInfo } from "./interpreter.js";
import { editableDir, insideWorktree } from "./states.js";

/**
 * D2's allow-listed variables: each changes which code runs or which
 * plugins load (environments 3). Policy `env.allowlist` is the core's: it
 * hashes those into every runner's environment itself (001 D3).
 */
export const PYTEST_VARIABLES = [
  "PYTHONPATH",
  "PYTHONSAFEPATH",
  "PYTHONNOUSERSITE",
  "PYTEST_ADDOPTS",
  "PYTEST_PLUGINS",
  "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
  "PY_IGNORE_IMPORTMISMATCH",
] as const;

/** An activation of another environment the daemon may have inherited. */
const ACTIVATION = ["VIRTUAL_ENV", "CONDA_PREFIX", "PYTHONHOME"] as const;

/**
 * Spec 007 D2: "A run spawns `<env>/bin/python -m pytest` with
 * `VIRTUAL_ENV=<env>`, `<env>/bin` first on `PATH`, and `VIRTUAL_ENV`,
 * `CONDA_PREFIX` and `PYTHONHOME` of the daemon removed, so a test's own
 * `subprocess.run(["python", ...])` reaches the same environment." The
 * inherited activation's `bin` leaves `PATH` too; the project's `env` is
 * merged before `VIRTUAL_ENV` and `PATH` are set.
 */
export function runEnvironment(
  env: AbsolutePath,
  project: PytestProject,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...source };
  const foreign = new Set<string>();
  for (const name of ACTIVATION) {
    const value = source[name];
    if (value !== undefined && name !== "PYTHONHOME") foreign.add(join(value, "bin"));
    delete result[name];
  }
  Object.assign(result, project.env);
  const path = (result.PATH ?? "").split(delimiter).filter((p) => p !== "" && !foreign.has(p));
  result.PATH = [join(env, "bin"), ...path].join(delimiter);
  result.VIRTUAL_ENV = env;
  return result;
}

/** The allow-listed variables set in a run environment; an empty value differs from unset. */
export function pytestVariables(run: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const name of PYTEST_VARIABLES) {
    const value = run[name];
    if (value !== undefined) variables[name] = value;
  }
  return variables;
}

export interface EnvironmentHashInputs {
  readonly root: AbsolutePath;
  readonly project: PytestProject;
  readonly files: EnvironmentFiles;
  readonly interpreter: InterpreterInfo;
  readonly config: PytestConfigFile | null;
  /** The config file's bytes, `null` without one. */
  readonly configText: string | null;
  /** From `pytestVariables` of the run environment. */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * The runner-side part of D2's environment hash. Squeal and adapter
 * versions, policy `env.allowlist` and the plugins' closures (D4) are
 * added by the adapter and the core.
 *
 * Every path inside the worktree is written relative to it, in `.pth` and
 * `direct_url.json` bytes too, so a second worktree with its own synced
 * environment hashes the same (goal 2) while an editable that points
 * elsewhere does not.
 */
export function environmentHash(inputs: EnvironmentHashInputs): string {
  const { root, project, files, interpreter, config } = inputs;
  const portable = portablePaths(root);
  const editables = worktreeEditables(root, files.directUrls);
  const plain = (entry: string) => unversioned(editables, entry);
  const encoded = JSON.stringify([
    portable(interpreter.realPath),
    interpreter.version,
    interpreter.implementation,
    interpreter.cacheTag,
    files.pyvenvCfg === null ? null : portable(files.pyvenvCfg),
    files.siteEntries.map(plain).sort(compare),
    files.pth.map(([name, text]) => [plain(name), portable(plain(text))]),
    files.directUrls.map(([name, text]) => [plain(name), portable(text)]),
    config === null ? null : (toRelative(root, config.path) ?? config.path),
    inputs.configText,
    project.python ?? null,
    project.args,
    Object.entries(project.env).sort(([a], [b]) => compare(a, b)),
    Object.entries(inputs.variables).sort(([a], [b]) => compare(a, b)),
  ]);
  return createHash("sha256").update(encoded).digest("hex");
}

/**
 * D2, amended 2026-10-15 (lessons defect 3): `[<name>-<version>, <name>]`
 * of each distribution whose `direct_url.json` names an editable install
 * inside the worktree. setuptools_scm, hatch-vcs and versioneer put the
 * commit in that version, and the closure already keys the code.
 */
function worktreeEditables(
  root: AbsolutePath,
  directUrls: EnvironmentFiles["directUrls"],
): readonly (readonly [string, string])[] {
  const stems: (readonly [string, string])[] = [];
  for (const [distInfo, text] of directUrls) {
    const dir = editableDir(text);
    if (dir === null || !insideWorktree(root, dir)) continue;
    const stem = distInfo.slice(0, -".dist-info".length);
    const at = stem.indexOf("-");
    if (at > 0) stems.push([stem, stem.slice(0, at)]);
  }
  return stems;
}

/**
 * Drops those distributions' versions from `text`, a site-packages entry
 * name or a `.pth` file's bytes, in the shapes setuptools writes:
 * `<name>-<version>.dist-info`, `__editable__.<name>-<version>.pth` and the
 * finder module `__editable___<name>_<version>_finder` in identifier form.
 * Every other distribution keeps name and version.
 */
function unversioned(stems: readonly (readonly [string, string])[], text: string): string {
  for (const [stem, name] of stems) {
    if (text === `${stem}.dist-info`) return `${name}.dist-info`;
    text = text
      .replaceAll(`__editable__.${stem}.`, `__editable__.${name}.`)
      .replaceAll(finder(stem), finder(name));
  }
  return text;
}

/** The finder module's name: setuptools' `safe_identifier` makes every non-word character `_`. */
function finder(stem: string): string {
  return `__editable___${stem}_finder`.replace(/\W/g, "_");
}

/**
 * Replaces the worktree root, as given and as its real path, with
 * `<worktree>` wherever it starts a path: followed by `/`, a quote, white
 * space or the end, so `/w/a` does not touch `/w/ab`.
 */
function portablePaths(root: AbsolutePath): (text: string) => string {
  const roots = [...new Set([root, realOr(root)])].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${roots.map(escapeRegExp).join("|")})(?=[/"'\\s]|$)`, "g");
  return (text) => text.replace(pattern, "<worktree>");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function realOr(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
