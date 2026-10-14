import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMissing, toRelative } from "../../../core/fs/index.js";
import type { AbsolutePath } from "../../../core/types/index.js";
import { readOptional } from "./site.js";

/**
 * pytest's config names at one directory, in its precedence
 * (`_pytest/config/findpaths.py` `locate_config`, pytest 9.1.1). Spec 007
 * D1 names the four pytest 8 has; pytest 9 adds `pytest.toml` and the hidden
 * forms before them.
 */
const NAMES = [
  "pytest.toml",
  ".pytest.toml",
  "pytest.ini",
  ".pytest.ini",
  "pyproject.toml",
  "tox.ini",
  "setup.cfg",
] as const;

export interface PytestConfigFile {
  readonly path: AbsolutePath;
  /** pytest's rootdir for `-c <path>`: the file's directory. */
  readonly rootdir: AbsolutePath;
  /**
   * `fallback` for a `pyproject.toml` without a pytest table, which pytest
   * takes when no directory up the walk holds a config.
   */
  readonly holds: "pytest" | "fallback";
}

/**
 * Spec 007 D1: "the configuration file is found by Squeal from files, with
 * pytest's own precedence at `cwd` [...]; configs never merge." The walk
 * goes from `cwd` up to the worktree root and never above it, as pytest's
 * does from its arguments; `null` when no directory there holds one, in
 * which case the runner passes its own empty config so that pytest does not
 * look above the worktree (review 007-16 B1).
 */
export function findPytestConfig(root: AbsolutePath, cwd: AbsolutePath): PytestConfigFile | null {
  let fallback: AbsolutePath | null = null;
  for (let dir = cwd; ; dir = dirname(dir)) {
    for (const name of NAMES) {
      const path = join(dir, name);
      const text = isFile(path) ? (readOptional(path) ?? "") : null;
      if (text === null) continue;
      if (name === "pyproject.toml" && fallback === null) fallback = path;
      if (holdsPytest(name, text)) return { path, rootdir: dir, holds: "pytest" };
    }
    if (toRelative(root, dir) === null) break;
  }
  return fallback === null
    ? null
    : { path: fallback, rootdir: dirname(fallback), holds: "fallback" };
}

/**
 * `load_config_dict_from_file` from text: `pytest.toml` and `pytest.ini`
 * (and their hidden forms) always count, even empty; `tox.ini` with a
 * `[pytest]` section; `setup.cfg` with `[tool:pytest]`; `pyproject.toml`
 * with a `[tool.pytest.ini_options]` table, or a `[tool.pytest]` table that
 * holds a key. Tables are read from header lines: a pytest table written as
 * dotted keys or an inline table is not seen.
 */
function holdsPytest(name: (typeof NAMES)[number], text: string): boolean {
  switch (name) {
    case "pytest.toml":
    case ".pytest.toml":
    case "pytest.ini":
    case ".pytest.ini":
      return true;
    case "tox.ini":
      return iniSections(text).includes("pytest");
    case "setup.cfg":
      return iniSections(text).includes("tool:pytest");
    case "pyproject.toml":
      return pyprojectHoldsPytest(text);
  }
}

/** Section names as `iniconfig` reads them: a `[name]` line at column 0, comments after it cut. */
function iniSections(text: string): readonly string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("[")) continue;
    const real = line.split("#")[0]?.split(";")[0]?.trimEnd() ?? "";
    if (real.endsWith("]")) names.push(real.slice(1, -1));
  }
  return names;
}

const TABLE = /^\s*\[\s*([^\][]+?)\s*\]\s*(?:#.*)?$/;
const KEY = /^\s*[A-Za-z0-9_"'-]/;

function pyprojectHoldsPytest(text: string): boolean {
  let table: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const header = TABLE.exec(line)?.[1]?.replace(/\s*\.\s*/g, ".");
    if (header !== undefined) {
      // `ini_options`, or a subtable that is TOML-mode content of `[tool.pytest]`.
      if (header.startsWith("tool.pytest.")) return true;
      table = header;
    } else if (table === "tool.pytest" && KEY.test(line)) return true;
  }
  return false;
}

function isFile(path: AbsolutePath): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return false;
    throw error;
  }
}
