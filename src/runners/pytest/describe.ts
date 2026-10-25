import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../core/types/index.js";
import type { CoveredProject, Listing, RunnerDescription } from "../descriptions.js";
import { discoverEnvironment, projectDir } from "./environment/discover.js";

/*
 * Spec 007 D8 on 005 D8 step 1: a pytest command, recognized as narrowly as
 * the Vitest and node:test ones. Anything not recognized here runs as
 * normal, so every doubt is `null`.
 */

/** A configured pytest project whose `cwd` is the directory the command runs from. */
export interface PytestHere {
  readonly project: PytestProject;
  /** The project's `cwd`, absolute. */
  readonly dir: AbsolutePath;
  /** Its environment directory by 007 D2's discovery; `null` without one. */
  readonly env: AbsolutePath | null;
}

/** A recognized pytest command: the project, and the paths it was narrowed to. */
export interface PytestCommand {
  readonly runner: "pytest";
  readonly project: string;
  /** Test files or directories, node IDs cut to their file, absolute; `null` runs the project's every file. */
  readonly paths: readonly AbsolutePath[] | null;
}

/** What the primer says of pytest (spec 007 D8). */
export interface PytestCoverage {
  /** Each `pytest` project, as `nodeTest`'s. Absent means none. */
  readonly pytest?: readonly CoveredProject[];
}

/** What recognizing a pytest command reads besides the command. */
export interface PytestContext {
  /** Spec 007 D8: the pytest projects run from the command's directory. Absent means none. */
  readonly pytest?: readonly PytestHere[];
}

/**
 * Flags that change only what pytest prints: `-q`, `-v` and `-s`, repeated
 * or combined, `-r<chars>` and `--tb=<style>`. Every other flag changes what
 * runs or how (`-k`, `-x`, `--lf`, `-n`), or is one Squeal does not know.
 */
const OUTPUT_FLAG = /^(-[qvs]+|-r[fEsxXpPaAwN]+|--tb=(auto|long|short|line|native|no))$/;

/**
 * pytest as the harness knows it (spec 016 D5): built for its configured
 * projects, which the primer names with their globs, and whose commands are
 * recognized from a project's `cwd`, inside the worktree root or below it.
 */
export const PYTEST = {
  runner: "pytest",
  name: "pytest",
  fallback: false,
  unconfigured: {},
  projects: (policy) => policy.pytest,
  coverage: ({ projects }): PytestCoverage => ({ pytest: projects }),
  built: (coverage) => (coverage.pytest?.length ?? 0) > 0,
  covered: (coverage) => ({ projects: coverage.pytest ?? [] }),
  excluded: () => null,
  context: (policy, root, cwd): PytestContext => ({ pytest: pytestHere(root, cwd, policy.pytest) }),
  command: (words, context) => pytestCommand(words, context.pytest ?? []),
  resolves: () => true,
  files: (command, listing) => (command.runner === "pytest" ? pytestFiles(command, listing) : null),
  slowProjects: () => [],
} satisfies RunnerDescription;

/** The pytest projects whose `cwd` is `cwd`, each with its environment by 007 D2's discovery. */
function pytestHere(
  root: AbsolutePath,
  cwd: string,
  projects: readonly PytestProject[],
): readonly PytestHere[] {
  return projects.flatMap((project) => {
    const dir = projectDir(root, project);
    if (realPath(dir) !== cwd) return [];
    let env: AbsolutePath | null = null;
    try {
      const found = discoverEnvironment(root, project);
      if (found.kind === "found") env = found.env;
    } catch {
      // An unreadable `.pdm-python` is no environment: only `pytest`, `python` and `uv run` match.
    }
    return [{ project, dir, env }];
  });
}

/** `path`'s real path, as `findWorktreeRoot` resolves the root; `null` when it does not exist. */
function realPath(path: string): string | null {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

/**
 * The pytest command `words` are, run from the one project in `here`:
 * `pytest`, `python -m pytest`, `uv run pytest`, `<env>/bin/pytest` or
 * `<env>/bin/python -m pytest`, then the project's own `args` as written in
 * the config, then test paths, node IDs and output flags only. `null` when
 * no project or more than one runs from here, or the project sets `env`,
 * which the command would not have.
 */
function pytestCommand(
  words: readonly string[],
  here: readonly PytestHere[],
): PytestCommand | null {
  if (here.length !== 1) return null;
  const { project, dir, env } = here[0] as PytestHere;
  if (Object.keys(project.env).length > 0) return null;
  const start = invocation(words, dir, env);
  if (start === null) return null;
  const rest = words.slice(start);
  const { args } = project;
  if (!args.every((arg, i) => rest[i] === arg)) return null;
  const paths: AbsolutePath[] = [];
  for (const word of rest.slice(args.length)) {
    if (OUTPUT_FLAG.test(word)) continue;
    const path = word.split("::")[0] as string;
    if (word.startsWith("-") || path === "") return null;
    paths.push(resolve(dir, path) as AbsolutePath);
  }
  return { runner: "pytest", project: project.name, paths: paths.length === 0 ? null : paths };
}

/** How many words name pytest itself, or `null` when they do not. */
function invocation(
  words: readonly string[],
  dir: AbsolutePath,
  env: AbsolutePath | null,
): number | null {
  const [first, second, third] = words;
  const inEnv = (name: string) =>
    env !== null && first?.includes("/") === true && resolve(dir, first) === join(env, "bin", name);
  if (first === "pytest" || inEnv("pytest")) return 1;
  if (first === "uv" && second === "run" && third === "pytest") return 3;
  if ((first === "python" || inEnv("python")) && second === "-m" && third === "pytest") return 3;
  return null;
}

/**
 * Spec 007 D8: a pytest command's files among its project's listed ones,
 * only when every path names one. No path and a directory, the root
 * included, do not resolve: pytest's own discovery would run every test
 * file under them, and Squeal's `include` and `exclude` need not list them
 * all, so the files it holds results for prove nothing about the rest
 * (review 007-19 B4). Nor does a path outside the worktree or naming no
 * listed file.
 */
function pytestFiles(command: PytestCommand, listing: Listing): readonly TestFileRef[] | null {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref) => ref.project === command.project);
  const named = new Set(command.paths.map((path) => listing.pathOf(path)));
  if (![...named].every((rel) => own.some((ref) => ref.path === rel))) return null;
  return own.filter((ref) => named.has(ref.path));
}
