import { posix } from "node:path";
import { toAbsolute } from "../core/fs/index.js";
import type { AbsolutePath, PytestProject } from "../core/types/index.js";
import { findPytestConfig, type PytestConfigFile } from "../runners/pytest/environment/config.js";
import { configArgs, readConfigValue } from "../runners/pytest/environment/config-values.js";
import { discoverEnvironment } from "../runners/pytest/environment/discover.js";
import { inheritedArgs, refusedFlags } from "../runners/pytest/run/command.js";

/*
 * Spec 007 D1: "`squeal setup` (005 D3) seeds one entry per detected
 * project: `cwd` where a pytest config or a `tests/` directory sits beside a
 * `pyproject.toml`, `include` from `testpaths` and `python_files`, `python`
 * from D2's discovery, and `args` left empty with a note when `addopts` or
 * `PYTEST_ADDOPTS` holds a flag D6 rejects."
 */

/** A `pytest` entry as written: `args` and `env` are left to their defaults. */
export type SeededPytest = Pick<PytestProject, "name" | "cwd" | "include" | "exclude">;

export interface PytestSeed {
  readonly projects: readonly SeededPytest[];
  /** One line per seeded project, per refused `addopts` flag and per project without an environment. */
  readonly notes: readonly string[];
}

/** The config file names pytest reads at one directory (`config.ts`'s, which it keeps private). */
const CONFIG_NAMES: ReadonlySet<string> = new Set([
  "pytest.toml",
  ".pytest.toml",
  "pytest.ini",
  ".pytest.ini",
  "pyproject.toml",
  "tox.ini",
  "setup.cfg",
]);

/** pytest's `python_files` default. */
const PYTHON_FILES = ["test_*.py", "*_test.py"];

/**
 * pytest's `norecursedirs` default, which applies when it recurses from
 * `cwd`; `{arch}` is left out, as Squeal's globs read braces as a choice.
 */
const NORECURSEDIRS = [".*", "*.egg", "_darcs", "build", "CVS", "dist", "node_modules", "venv"];

/**
 * Directories never taken for a project: another tool's, and test fixtures,
 * whose `pyproject.toml` describes a project the tests build, not one to
 * validate (this repository's `test/fixtures/pytest/`).
 */
const SKIPPED = /(^|\/)(node_modules|fixtures|__fixtures__|\.[^/]*)(\/|$)/;

/**
 * The pytest projects of the worktree at `root`, from its `tracked` files
 * (worktree-relative), with `env` for `PYTEST_ADDOPTS`. Reads files only.
 */
export function seedPytest(
  root: AbsolutePath,
  tracked: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): PytestSeed {
  const dirs = projectDirs(root, tracked);
  const projects: SeededPytest[] = [];
  const notes: string[] = [];
  for (const dir of dirs) {
    const cwd = toAbsolute(root, dir);
    const found = findPytestConfig(root, cwd);
    const config = found?.rootdir === cwd && found.holds === "pytest" ? found : null;
    const name = dir === "" ? "pytest" : dir;
    const nested = dirs.filter((d) => d !== dir && (dir === "" || d.startsWith(`${dir}/`)));
    const entry = seededEntry(name, dir, config, nested);
    projects.push(entry);
    const from =
      config === null ? `${posix.join(dir, "tests")}/ beside pyproject.toml` : rel(root, config);
    notes.push(`seeded pytest project "${name}" from ${from}`);
    const project = { ...entry, args: [], env: {} };
    const refused = refusedFlags(inheritedArgs(found, env as NodeJS.ProcessEnv), project);
    if (refused.length > 0) {
      const flags = refused.map((r) => `${r.flag} (in ${r.source})`).join(", ");
      notes.push(
        `pytest project "${name}": Squeal does not run pytest with ${flags}, which change what runs or wait for input; remove it there, or its checks stay unknown`,
      );
    }
    const discovery = discoverEnvironment(root, project);
    if (discovery.kind === "none") {
      notes.push(
        `pytest project "${name}" has no environment yet; \`${discovery.command}\` in ${dir === "" ? "the root" : dir} creates one`,
      );
    }
  }
  return { projects, notes };
}

/** The entry of one project: `include` from `testpaths` and `python_files`, nested projects excluded. */
function seededEntry(
  name: string,
  dir: string,
  config: PytestConfigFile | null,
  nested: readonly string[],
): SeededPytest {
  // A key the config does not set is pytest's default, not an empty list.
  const value = (key: string) => {
    const raw = config === null ? undefined : readConfigValue(config, key);
    return raw === undefined ? null : configArgs(raw);
  };
  const testpaths = value("testpaths") ?? [];
  const pythonFiles = value("python_files") ?? PYTHON_FILES;
  const bases = testpaths.length === 0 ? [""] : testpaths;
  const include = bases.flatMap((base) =>
    pythonFiles.map((pattern) => posix.join(base, "**", pattern)),
  );
  // Only without `testpaths` does pytest recurse from `cwd`, past `norecursedirs` and into nested projects.
  const exclude =
    testpaths.length === 0
      ? [
          ...(value("norecursedirs") ?? NORECURSEDIRS).map((d) => `**/${d}/**`),
          ...nested.map((d) => `${posix.relative(dir, d)}/**`),
        ]
      : [];
  return {
    name,
    ...(dir === "" ? {} : { cwd: dir }),
    include,
    ...(exclude.length === 0 ? {} : { exclude }),
  };
}

/**
 * Directories, worktree-relative (`""` for the root), holding a pytest
 * config, or a `pyproject.toml` with a tracked file under `tests/` beside it.
 */
function projectDirs(root: AbsolutePath, tracked: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const path of tracked) {
    const name = posix.basename(path);
    if (!CONFIG_NAMES.has(name)) continue;
    const dir = posix.dirname(path) === "." ? "" : posix.dirname(path);
    if (SKIPPED.test(dir)) continue;
    const cwd = toAbsolute(root, dir);
    const config = findPytestConfig(root, cwd);
    const holds = config?.rootdir === cwd && config.holds === "pytest";
    const tests = `${posix.join(dir, "tests")}/`;
    if (holds || (name === "pyproject.toml" && tracked.some((p) => p.startsWith(tests)))) {
      dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

function rel(root: AbsolutePath, config: PytestConfigFile): string {
  return posix.relative(root, config.path);
}
