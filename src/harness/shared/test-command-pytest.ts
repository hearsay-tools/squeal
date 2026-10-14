import { join, resolve } from "node:path";
import type { AbsolutePath, PytestProject } from "../../core/types/index.js";

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

/**
 * Flags that change only what pytest prints: `-q`, `-v` and `-s`, repeated
 * or combined, `-r<chars>` and `--tb=<style>`. Every other flag changes what
 * runs or how (`-k`, `-x`, `--lf`, `-n`), or is one Squeal does not know.
 */
const OUTPUT_FLAG = /^(-[qvs]+|-r[fEsxXpPaAwN]+|--tb=(auto|long|short|line|native|no))$/;

/**
 * The pytest command `words` are, run from the one project in `here`:
 * `pytest`, `python -m pytest`, `uv run pytest`, `<env>/bin/pytest` or
 * `<env>/bin/python -m pytest`, then the project's own `args` as written in
 * the config, then test paths, node IDs and output flags only. `null` when
 * no project or more than one runs from here, or the project sets `env`,
 * which the command would not have.
 */
export function pytestCommand(
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
