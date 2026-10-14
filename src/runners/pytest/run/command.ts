import type { AbsolutePath, PytestProject } from "../../../core/types/index.js";
import { configArgs, readConfigValue, shellSplit } from "../environment/config-values.js";
import type { PytestConfigFile, PytestPlugin } from "../environment/index.js";

/**
 * Spec 007 D6: "a flag Squeal cannot override (`--lf`, `--ff`, `--sw`,
 * `--pdb`, `--snapshot-update`, `--looponfail`) in either makes the project a
 * runner failure with one note naming it." Their long forms, `--sw-skip`,
 * `--trace` (a debugger at every test) and xdist's `-f` too.
 */
const REFUSED: Readonly<Record<string, string>> = {
  "--lf": "--lf",
  "--last-failed": "--lf",
  "--ff": "--ff",
  "--failed-first": "--ff",
  "--sw": "--sw",
  "--stepwise": "--sw",
  "--sw-skip": "--sw-skip",
  "--stepwise-skip": "--sw-skip",
  "--pdb": "--pdb",
  "--trace": "--trace",
  "--snapshot-update": "--snapshot-update",
  "--looponfail": "--looponfail",
  "-f": "--looponfail",
};

/** Where a refused flag was found. */
export type FlagSource = "addopts" | "PYTEST_ADDOPTS" | "args" | "pytest";

export interface RefusedFlag {
  readonly flag: string;
  readonly source: FlagSource;
}

/** The arguments pytest adds before Squeal's own: config `addopts`, then `PYTEST_ADDOPTS` (runner-api F4). */
export interface InheritedArgs {
  readonly addopts: readonly string[];
  readonly envAddopts: readonly string[];
}

export function inheritedArgs(
  config: PytestConfigFile | null,
  env: NodeJS.ProcessEnv,
): InheritedArgs {
  const addopts = config === null ? [] : (configArgs(readConfigValue(config, "addopts")) ?? []);
  return { addopts, envAddopts: shellSplit(env.PYTEST_ADDOPTS ?? "") ?? [] };
}

/** The refused flags in the config's `addopts`, `PYTEST_ADDOPTS` and the project's `args`, read from files. */
export function refusedFlags(inherited: InheritedArgs, project: PytestProject): RefusedFlag[] {
  const found: RefusedFlag[] = [];
  const scan = (tokens: readonly string[], source: FlagSource) => {
    for (const token of tokens) {
      const flag = REFUSED[token.split("=")[0] as string];
      if (flag !== undefined && !found.some((f) => f.flag === flag && f.source === source)) {
        found.push({ flag, source });
      }
    }
  };
  scan(inherited.addopts, "addopts");
  scan(inherited.envAddopts, "PYTEST_ADDOPTS");
  scan(project.args, "args");
  return found;
}

/** One note for every refusal, whether found in files or by the plugin in `pytest_configure`. */
export function refusalNote(project: PytestProject, refused: readonly RefusedFlag[]): string {
  const where = (source: FlagSource) =>
    source === "pytest" ? "in pytest's resolved options" : `in ${source}`;
  const flags = refused.map((r) => `${r.flag} (${where(r.source)})`).join(", ");
  return `pytest project "${project.name}": Squeal does not run pytest with ${flags}, which change what runs or wait for input; its checks stay unknown until the flag is removed.`;
}

export interface CommandInputs {
  readonly project: PytestProject;
  readonly config: PytestConfigFile | null;
  readonly plugins: readonly PytestPlugin[];
  readonly env: NodeJS.ProcessEnv;
  readonly inherited: InheritedArgs;
  /** pytest's cache directory, under Squeal's temp directory. */
  readonly cacheDir: AbsolutePath;
  /** An empty `pytest.ini` Squeal owns, passed with `-c` when the project has no config. */
  readonly emptyConfig: AbsolutePath;
}

/**
 * Spec 007 D6: `-m pytest -c <config> -p squeal_pytest
 * --continue-on-collection-errors <overrides> <args...>`, the files after
 * them. The overrides follow `args`, since the last of a repeated option
 * wins: `--maxfail=0`; `-n 0` when xdist loads and `--no-cov` when
 * pytest-cov does (an unknown flag is a usage error); `-o cache_dir=`.
 * Without a config file pytest would take one from above the worktree, which
 * no hash covers (review 007-16 B1): Squeal passes its own empty one, the cwd
 * as the rootdir and as the conftest cut, which pytest would otherwise put
 * at the empty file's directory.
 */
export function pytestArgs(inputs: CommandInputs, cwd: AbsolutePath): string[] {
  const { project, config } = inputs;
  const overrides = ["--maxfail=0"];
  if (loads(inputs, "pytest_xdist")) overrides.push("-n", "0");
  if (loads(inputs, "pytest_cov")) overrides.push("--no-cov");
  overrides.push("-o", `cache_dir=${inputs.cacheDir}`);
  return [
    "-m",
    "pytest",
    ...(config === null
      ? ["-c", inputs.emptyConfig, `--rootdir=${cwd}`, `--confcutdir=${cwd}`]
      : ["-c", config.path]),
    "-p",
    "squeal_pytest",
    "--continue-on-collection-errors",
    ...project.args,
    ...overrides,
  ];
}

/**
 * Whether the distribution's `pytest11` plugin loads: installed, not
 * blocked with `-p no:<name>`, and either autoloaded or named with `-p` or
 * in `PYTEST_PLUGINS`.
 */
function loads(inputs: CommandInputs, distribution: string): boolean {
  const own = inputs.plugins.filter((p) => normalize(p.distribution) === distribution);
  if (own.length === 0) return false;
  const tokens = [
    ...inputs.inherited.addopts,
    ...inputs.inherited.envAddopts,
    ...inputs.project.args,
  ];
  const named = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === "-p") named.add(tokens[++i] ?? "");
    else if (token.startsWith("-p")) named.add(token.slice(2));
  }
  for (const name of (inputs.env.PYTEST_PLUGINS ?? "").split(",")) named.add(name.trim());
  if (own.some((p) => named.has(`no:${p.name}`))) return false;
  const autoload = (inputs.env.PYTEST_DISABLE_PLUGIN_AUTOLOAD ?? "") === "";
  return autoload || own.some((p) => named.has(p.name) || named.has(p.module));
}

function normalize(distribution: string): string {
  return distribution.toLowerCase().replace(/[-.]+/g, "_");
}
