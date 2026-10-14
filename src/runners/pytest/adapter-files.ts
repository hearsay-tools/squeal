import { type Dirent, existsSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { compare } from "../../core/fs/index.js";
import { createInputMatcher } from "../../core/keys/glob.js";
import type { AbsolutePath, PytestProject, RelativePath } from "../../core/types/index.js";
import { environmentDir } from "./adapter-environment.js";
import { configArgs, readConfigValue } from "./environment/config-values.js";
import { findPytestConfig, projectDir } from "./environment/index.js";

/**
 * pytest's `norecursedirs` default (`_pytest/main.py`, pytest 9.1.1), which
 * applies when the config does not set the key.
 */
const NORECURSEDIRS = [
  ".*",
  "*.egg",
  "_darcs",
  "build",
  "CVS",
  "dist",
  "node_modules",
  "venv",
  "{arch}",
];
/** pytest's `python_files` default. */
const PYTHON_FILES = ["test_*.py", "*_test.py"];
const GLOB = /[*?[{]/;
/** How many skipped directories one note names before it only counts. */
const NAMED_SKIPPED = 10;

/**
 * Spec 007 D3: "`testFiles()` expands `include` minus `exclude` under `cwd`
 * with Squeal's matcher." Globs are relative to `cwd`; the result is
 * worktree-relative and sorted. Only the directories the globs can reach
 * are walked, as pytest recurses (task 007-35, `lessons.md` defect 1): never
 * a directory the project's `norecursedirs` names (pytest's default list
 * when unset), a `__pycache__`, a virtual environment (a directory holding
 * `pyvenv.cfg`, pytest's `_in_venv`), the project's environment directory
 * or `.git`; symbolic links are not followed. `note` gets one text naming the
 * `norecursedirs` directories that hold a file the globs and `python_files`
 * match, so that tests no run reaches are never silent.
 */
export function listTestFiles(
  root: AbsolutePath,
  project: PytestProject,
  note?: (text: string) => void,
): RelativePath[] {
  const cwd = projectDir(root, project);
  const include = createInputMatcher(project.include);
  const exclude = createInputMatcher(project.exclude ?? []);
  const { norecursedirs, pythonFiles } = recursionSettings(root, cwd);
  const env = environmentDir(root, project);
  const listed = (path: AbsolutePath) => {
    const fromCwd = slashes(relative(cwd, path));
    return include(fromCwd) && !exclude(fromCwd);
  };
  const isTest = (path: AbsolutePath) =>
    listed(path) && pythonFiles.some((pattern) => fnmatchEx(pattern, path));
  const found: RelativePath[] = [];
  const skipped: RelativePath[] = [];
  const walk = (dir: AbsolutePath): void => {
    for (const entry of entries(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (never(path, env)) continue;
        if (!norecursedirs.some((pattern) => fnmatchEx(pattern, path))) walk(path);
        else if (holds(path, env, isTest)) skipped.push(slashes(relative(root, path)));
      } else if (entry.isFile() && listed(path)) found.push(slashes(relative(root, path)));
    }
  };
  for (const base of bases(project.include)) walk(join(cwd, base));
  if (skipped.length > 0) note?.(skippedNote(skipped.sort(compare)));
  return found.sort(compare);
}

/** `norecursedirs` and `python_files` from the project's pytest config, pytest's defaults when unset. */
function recursionSettings(
  root: AbsolutePath,
  cwd: AbsolutePath,
): { norecursedirs: readonly string[]; pythonFiles: readonly string[] } {
  const config = findPytestConfig(root, cwd);
  const value = (key: string, fallback: readonly string[]) => {
    const raw = config === null ? undefined : readConfigValue(config, key);
    return raw === undefined ? fallback : (configArgs(raw) ?? fallback);
  };
  return {
    norecursedirs: value("norecursedirs", NORECURSEDIRS),
    pythonFiles: value("python_files", PYTHON_FILES),
  };
}

/** Never walked, whatever `norecursedirs` says, and never named in the note. */
function never(path: AbsolutePath, env: AbsolutePath): boolean {
  const name = basename(path);
  return (
    name === ".git" ||
    name === "__pycache__" ||
    path === env ||
    existsSync(join(path, "pyvenv.cfg"))
  );
}

/**
 * Whether a skipped directory holds a test file at any depth, stopping at
 * the first. Dot directories and `node_modules` are tools' own, and
 * not searched: a `node_modules` tree would cost a walk at every listing.
 */
function holds(
  dir: AbsolutePath,
  env: AbsolutePath,
  isTest: (path: AbsolutePath) => boolean,
): boolean {
  const name = basename(dir);
  if (name.startsWith(".") || name === "node_modules") return false;
  return entries(dir).some((entry) => {
    const path = join(dir, entry.name);
    if (entry.isFile()) return isTest(path);
    return entry.isDirectory() && !never(path, env) && holds(path, env, isTest);
  });
}

function entries(dir: AbsolutePath): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function skippedNote(dirs: readonly RelativePath[]): string {
  const named = dirs.slice(0, NAMED_SKIPPED).join(", ");
  const more = dirs.length > NAMED_SKIPPED ? ", ..." : "";
  return `its norecursedirs skips ${dirs.length} director${dirs.length === 1 ? "y" : "ies"} holding test files, which neither pytest nor Squeal runs until norecursedirs allows them: ${named}${more}`;
}

/**
 * pytest's `fnmatch_ex` (`_pytest/pathlib.py`): a pattern without a slash
 * matches the base name, one with a slash the whole path, after any
 * directory. `fnmatch` as Python's: `*` crosses slashes.
 */
export function fnmatchEx(pattern: string, path: AbsolutePath): boolean {
  if (!pattern.includes("/")) return fnmatch(pattern).test(basename(path));
  return fnmatch(pattern.startsWith("/") ? pattern : `*/${pattern}`).test(slashes(path));
}

/** Python's `fnmatch.translate`: `*`, `?`, `[seq]` and `[!seq]`; an unclosed `[` is literal. */
function fnmatch(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (c === "[") {
      let j = i + 1;
      if (pattern[j] === "!") j++;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j >= pattern.length) out += "\\[";
      else {
        let set = pattern.slice(i + 1, j).replace(/\\/g, "\\\\");
        if (set.startsWith("!")) set = `^${set.slice(1)}`;
        else if (set.startsWith("^")) set = `\\${set}`;
        out += `[${set}]`;
        i = j;
      }
    } else out += c.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "s");
}

/**
 * The directories, relative to `cwd`, below which the globs can match: each
 * glob's leading segments without a glob character, nested ones dropped.
 */
function bases(globs: readonly string[]): string[] {
  const all = globs.map((glob) => {
    const segments = (glob.startsWith("./") ? glob.slice(2) : glob).split("/");
    const literal: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      if (GLOB.test(segment)) break;
      literal.push(segment);
    }
    return literal.join("/");
  });
  const sorted = [...new Set(all)].sort(compare);
  return sorted.filter(
    (base, i) => !sorted.slice(0, i).some((other) => other === "" || base.startsWith(`${other}/`)),
  );
}

export function slashes(path: string): string {
  return path.split(sep).join("/");
}
