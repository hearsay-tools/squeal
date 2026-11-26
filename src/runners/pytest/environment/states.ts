import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { isMissing } from "../../../core/fs/errors.js";
import { isRecord } from "../../../core/fs/json.js";
import { toRelative } from "../../../core/fs/paths.js";
import type { AbsolutePath } from "../../../core/types/common.js";
import type { PytestProject } from "../../../core/types/policy.js";
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
      /** No install command is suggested for an explicitly unsupported PEP 582 layout. */
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
      return {
        state: "none",
        command: null,
        note: `pytest project "${project.name}": ${displayDir(root, join(cwd, "pdm.toml"))} sets \`python.use_venv = false\`. Squeal does not support PEP 582 (\`__pypackages__\`), and no supported Python environment was found, so Squeal runs none of its tests and inherits none of their results. Use a project-approved local virtual environment in ${where}, with the project's test dependencies installed there. Squeal then uses its normal environment checks before running tests or inheriting results.`,
      };
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
    const path = realOr(named);
    if (buildStageEmpty(site, join(site, name), path)) continue;
    found.push({
      distribution: name.slice(0, -".dist-info".length).split("-")[0] as string,
      path,
    });
  }
  return found;
}

/**
 * Spec 027 D3: an outside editable that cannot import code, such as a
 * container build stage's `/pkgs` holding only `pyproject.toml`, `uv.lock`
 * and `.venv`. All must hold: the directory exists outside any git checkout;
 * every `.pth` its `RECORD` lists adds only code-free directories or an empty
 * setuptools finder; the directory holds no code outside `.venv` and
 * `__pypackages__`. Any error or doubt refuses.
 */
function buildStageEmpty(site: AbsolutePath, distInfo: AbsolutePath, dir: AbsolutePath): boolean {
  try {
    if (!lstatSync(dir).isDirectory() || insideGitCheckout(dir)) return false;
    const pths = recordedPths(readOptional(join(distInfo, "RECORD")));
    if (pths === null || !pths.every((pth) => pthAddsNoCode(site, pth))) return false;
    return codeFree(dir);
  } catch {
    // Unreadable or vanished: an editable we cannot prove empty stays refused.
    return false;
  }
}

/**
 * Whether `dir` or an ancestor holds `.git`: another worktree or checkout,
 * of this repository or any other. Stricter than "another worktree of this
 * repository", and a build stage's directory has none.
 */
function insideGitCheckout(dir: AbsolutePath): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (exists(join(at, ".git"))) return true;
    if (dirname(at) === at) return false;
  }
}

/** Top-level `.pth` files a `RECORD` lists; `null` without a `RECORD`. */
function recordedPths(record: string | null): readonly string[] | null {
  if (record === null) return null;
  return record
    .split(/\r?\n/)
    .map((line) => line.split(",")[0]?.replace(/^"|"$/g, "") ?? "")
    .filter((path) => path.endsWith(".pth") && !/[\\/]/.test(path));
}

const FINDER_IMPORT = /^import (__editable___\w+_finder); \1\.install\(\)$/;
const EMPTY_MAPPING = /^MAPPING(?:\s*:[^=\n]*)?\s*=\s*\{\}\s*$/m;
const EMPTY_NAMESPACES = /^NAMESPACES(?:\s*:[^=\n]*)?\s*=\s*\{\}\s*$/m;

/**
 * Whether a `.pth` adds only code-free directories, as `site.addpackage`
 * reads it: comments and blank lines skipped, `import` lines executed,
 * other lines joined to the site directory. The only `import` line allowed
 * installs a setuptools editable finder whose `MAPPING` and `NAMESPACES`
 * are empty.
 */
function pthAddsNoCode(site: AbsolutePath, pth: string): boolean {
  const text = readOptional(join(site, pth));
  if (text === null) return false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    if (/^import[ \t]/.test(line)) {
      const finder = FINDER_IMPORT.exec(line)?.[1];
      const source = finder === undefined ? null : readOptional(join(site, `${finder}.py`));
      if (source === null || !EMPTY_MAPPING.test(source) || !EMPTY_NAMESPACES.test(source)) {
        return false;
      }
      continue;
    }
    const dir = resolve(site, line);
    if (!lstatSync(dir).isDirectory() || !codeFree(realOr(dir))) return false;
  }
  return true;
}

const CODE = /\.(?:py|pyc|pyd|so)$/;
const SKIPPED = new Set([".venv", "__pypackages__"]);
const SCAN_LIMIT = 10_000;

/**
 * Whether `dir` holds no Python module, compiled or source, at any depth
 * outside `.venv` and `__pypackages__`. A symlink, a special file or more
 * than `SCAN_LIMIT` entries count as code.
 */
function codeFree(dir: AbsolutePath): boolean {
  const pending = [dir];
  let seen = 0;
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (++seen > SCAN_LIMIT) return false;
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) pending.push(join(at, entry.name));
      } else if (!entry.isFile() || CODE.test(entry.name)) {
        return false;
      }
    }
  }
  return true;
}

function exists(path: AbsolutePath): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
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
