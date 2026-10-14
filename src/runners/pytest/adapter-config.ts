import { resolve } from "node:path";
import type { AbsolutePath, PytestProject } from "../../core/types/index.js";
import type { CollectionNames } from "./enumerate.js";
import { configArgs, readConfigValue, shellSplit } from "./environment/config-values.js";
import { findPytestConfig, type PytestConfigFile, projectDir } from "./environment/index.js";
import type { ImportMode } from "./graph/index.js";

/**
 * What the project's pytest config and arguments say for the graph and
 * enumeration (spec 007 D1: "Its `testpaths`, `python_files`,
 * `python_classes`, `python_functions`, `addopts` and `pythonpath` are read
 * for D3 and D6"). Read from files, so it holds without an environment.
 *
 * `python_files` is not among them: Squeal names every file on pytest's
 * command line, and pytest collects a file named there whatever its name.
 */
export interface ProjectSettings {
  readonly config: PytestConfigFile | null;
  /** pytest's rootdir: the config file's directory, else `cwd`. */
  readonly rootdir: AbsolutePath;
  readonly importMode: ImportMode;
  /** The config's `pythonpath`, absolute, in order. */
  readonly pythonpath: readonly AbsolutePath[];
  readonly names: CollectionNames;
  /** Plugin modules `-p` names in `addopts`, `PYTEST_ADDOPTS` and `args`, for D2's plugin closure. */
  readonly pluginModules: readonly string[];
}

const IMPORT_MODES: ReadonlySet<string> = new Set(["prepend", "append", "importlib"]);

/** `ProjectSettings` of one project; `env` is the run environment, for `PYTEST_ADDOPTS`. */
export function projectSettings(
  root: AbsolutePath,
  project: PytestProject,
  env: NodeJS.ProcessEnv,
): ProjectSettings {
  const cwd = projectDir(root, project);
  const config = findPytestConfig(root, cwd);
  const value = (key: string) =>
    config === null ? [] : (configArgs(readConfigValue(config, key)) ?? []);
  const rootdir = config?.rootdir ?? cwd;
  // pytest's order: `addopts`, then `PYTEST_ADDOPTS`, then the command line; the last wins.
  const tokens = [
    ...value("addopts"),
    ...(shellSplit(env.PYTEST_ADDOPTS ?? "") ?? []),
    ...project.args,
  ];
  const functions = value("python_functions");
  const classes = value("python_classes");
  return {
    config,
    rootdir,
    importMode: importMode(tokens),
    // A `paths` value: relative to the config file's directory.
    pythonpath: value("pythonpath").map((p) => resolve(rootdir, p)),
    names: {
      ...(functions.length === 0 ? {} : { pythonFunctions: functions }),
      ...(classes.length === 0 ? {} : { pythonClasses: classes }),
    },
    pluginModules: pluginModules(tokens),
  };
}

/** Two settings that build the same graph and enumerate alike. */
export function sameSettings(a: ProjectSettings, b: ProjectSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function importMode(tokens: readonly string[]): ImportMode {
  let mode: ImportMode = "prepend";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const value =
      token === "--import-mode"
        ? tokens[++i]
        : token.startsWith("--import-mode=")
          ? token.slice("--import-mode=".length)
          : undefined;
    if (value !== undefined && IMPORT_MODES.has(value)) mode = value as ImportMode;
  }
  return mode;
}

/** `-p name` and `-pname`, without `no:` blocks. */
function pluginModules(tokens: readonly string[]): string[] {
  const named: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const name = token === "-p" ? tokens[++i] : token.startsWith("-p") ? token.slice(2) : undefined;
    if (name !== undefined && name !== "" && !name.startsWith("no:")) named.push(name);
  }
  return [...new Set(named)];
}
