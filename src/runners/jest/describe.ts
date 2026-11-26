import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "../../core/fs/json.js";
import { toAbsolute } from "../../core/fs/paths.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { JestProject } from "../../core/types/policy-jest.js";
import type { CoveredProject, Listing, RunnerDescription, ShellWords } from "../descriptions.js";

/*
 * Spec 028 D6.3 on 005 D8 step 1: a plain Jest command, recognized as
 * narrowly as the pytest one, and only for 005 D8's opt-in deny. Anything
 * not recognized here runs as normal, so every doubt is `null`. Nx commands
 * are never Jest's own: they run through Nx's executor, cache and targets.
 */

/** A configured Jest project whose `cwd` is the directory the command runs from. */
export interface JestHere {
  readonly project: JestProject;
  /** The project's `cwd`, absolute. */
  readonly dir: AbsolutePath;
  /** The scripts of the `package.json` in `dir`; none when it is missing or unreadable. */
  readonly scripts: Readonly<Record<string, string>>;
}

/** A recognized Jest command: the project, and the test files it was narrowed to. */
export interface JestCommand {
  readonly runner: "jest";
  readonly project: string;
  /** The project's `cwd`, absolute: Jest matches each path pattern from here. */
  readonly dir: AbsolutePath;
  /** The path patterns as written; `null` runs the project's every file. */
  readonly paths: readonly string[] | null;
}

/** Jest's part of a worktree's coverage (spec 028 D6.3). */
export interface JestCoverage {
  /** Each `jest` project, as `pytest`'s. Absent means none. */
  readonly jest?: readonly CoveredProject[];
}

/** What recognizing a Jest command reads besides the command. */
export interface JestContext {
  /** The Jest projects run from the command's directory. Absent means none. */
  readonly jest?: readonly JestHere[];
}

/** Flags that change only what Jest prints, or how many workers it starts, never what runs. */
const OUTPUT_FLAGS: ReadonlySet<string> = new Set([
  "--verbose",
  "--silent",
  "--no-color",
  "--colors",
  "--ci",
  "--runInBand",
]);

/**
 * Jest as the harness knows it (spec 016 D5): built for its configured
 * projects, and whose plain commands are recognized from a project's `cwd`.
 */
export const JEST = {
  runner: "jest",
  name: "Jest",
  unconfigured: {},
  projects: (policy) => policy.jest,
  coverage: ({ projects }): JestCoverage => ({ jest: projects }),
  excluded: () => null,
  context: (policy, root, cwd): JestContext => ({ jest: jestHere(root, cwd, policy.jest) }),
  command: (words, context, split) => jestCommand(words, context.jest ?? [], split),
  resolves: () => true,
  files: (command, listing) => (command.runner === "jest" ? jestFiles(command, listing) : null),
  // The daemon reads `jest[].slow` from the policy itself, as `pytest[].slow` (004 D1).
  slowProjects: () => [],
} satisfies RunnerDescription;

/**
 * The Jest projects a plain `jest` run from `cwd` runs as configured: the
 * project's `cwd`, real, is `cwd`, its config sits there too, and Jest's own
 * config search there finds that config and no other (review 0.1.646 B1).
 * A custom config name, a `cwd` apart from the config's directory, or a
 * search Jest would refuse, runs the files under another config: no match.
 */
function jestHere(
  root: AbsolutePath,
  cwd: string,
  projects: readonly JestProject[],
): readonly JestHere[] {
  return projects.flatMap((project) => {
    // An inline sub-project of a root `projects` config: plain `jest` runs the whole root config.
    if (project.project !== undefined) return [];
    const config = toAbsolute(root, project.config);
    const dir = project.cwd === undefined ? dirname(config) : toAbsolute(root, project.cwd);
    if (realPath(dir) !== cwd || realPath(dirname(config)) !== cwd) return [];
    if (!discovers(dir, config)) return [];
    return [{ project, dir: dir as AbsolutePath, scripts: scriptsIn(dir) }];
  });
}

/** The config file names Jest 29 and 30 search a directory for, before `package.json`. */
const CONFIG_NAMES: readonly string[] = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.cjs",
  "jest.config.mts",
  "jest.config.cts",
  "jest.config.json",
];

/**
 * Whether Jest's config search in `dir` finds `config` alone: each config
 * file name there, and a `package.json` with a `jest` key, is a candidate;
 * Jest refuses more than one, and none sends its search elsewhere. An
 * unreadable `package.json` leaves the search in doubt.
 */
function discovers(dir: string, config: string): boolean {
  const candidates = CONFIG_NAMES.map((name) => join(dir, name)).filter(isFile);
  const manifest = join(dir, "package.json");
  if (isFile(manifest)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      return false;
    }
    if (isRecord(parsed) && Object.hasOwn(parsed, "jest")) candidates.push(manifest);
  }
  if (candidates.length !== 1) return false;
  const found = realPath(candidates[0] as string);
  return found !== null && found === realPath(config);
}

/**
 * The Jest command `words` are, run from the one project in `here` that
 * sets no `env`, which the command would not have: `jest`, `npx jest`,
 * `pnpm exec jest` or `./node_modules/.bin/jest`, then the project's own
 * `args` as written, then output flags and test paths only; or a bare
 * `npm test` or `pnpm test` whose script is such a command with no path and
 * has no `pretest` or `posttest` beside it.
 */
function jestCommand(
  words: readonly string[],
  here: readonly JestHere[],
  split: ShellWords,
): JestCommand | null {
  if (here.length !== 1) return null;
  const at = here[0] as JestHere;
  if (Object.keys(at.project.env).length > 0) return null;
  const [first, second] = words;
  if ((first === "npm" || first === "pnpm") && second === "test" && words.length === 2) {
    const { scripts } = at;
    if (!Object.hasOwn(scripts, "test")) return null;
    if (Object.hasOwn(scripts, "pretest") || Object.hasOwn(scripts, "posttest")) return null;
    const script = split(scripts.test as string);
    const command = script === null ? null : direct(script, at);
    return command?.paths === null ? command : null;
  }
  return direct(words, at);
}

/** A direct Jest invocation from `at`, or `null`. */
function direct(words: readonly string[], at: JestHere): JestCommand | null {
  const start = invocation(words, at.dir);
  if (start === null) return null;
  const rest = words.slice(start);
  const { args } = at.project;
  if (!args.every((arg, i) => rest[i] === arg)) return null;
  const paths: string[] = [];
  for (const word of rest.slice(args.length)) {
    if (OUTPUT_FLAGS.has(word)) continue;
    if (word.startsWith("-") || word === "") return null;
    paths.push(word);
  }
  // A path pattern can select a file Jest lists and the project's `include` or `exclude` leaves out.
  const { include, exclude } = at.project;
  if (paths.length > 0 && include.length + exclude.length > 0) return null;
  return {
    runner: "jest",
    project: at.project.name,
    dir: at.dir,
    paths: paths.length === 0 ? null : paths,
  };
}

/** How many words name Jest itself, or `null` when they do not. */
function invocation(words: readonly string[], dir: AbsolutePath): number | null {
  const [first, second, third] = words;
  if (first === "jest") return 1;
  if (first?.includes("/") === true && resolve(dir, first) === join(dir, "node_modules/.bin/jest"))
    return 1;
  if (first === "npx" && second === "jest") return 2;
  if (first === "pnpm" && second === "exec" && third === "jest") return 3;
  return null;
}

/**
 * D6.3: a Jest command's files among its project's listed ones, only when
 * every path names one and Jest would run no other listed file. No path,
 * a directory, and a path outside the worktree or naming no listed file do
 * not resolve. Jest reads each path as a case-insensitive pattern over
 * absolute paths, so `a.test.ts` also selects `b/a.test.ts`: the files the
 * patterns select must be exactly the files they name.
 */
function jestFiles(command: JestCommand, listing: Listing): readonly TestFileRef[] | null {
  if (command.paths === null) return null;
  const own = listing.files.filter((ref) => ref.project === command.project);
  const named = new Set(command.paths.map((path) => listing.pathOf(resolve(command.dir, path))));
  if (![...named].every((rel) => own.some((ref) => ref.path === rel))) return null;
  let patterns: RegExp[];
  try {
    patterns = command.paths.map((path) => new RegExp(path, "i"));
  } catch {
    return null;
  }
  const selected = own.filter((ref) => {
    const path = join(listing.root, ref.path);
    return patterns.some((pattern) => pattern.test(path));
  });
  if (!selected.every((ref) => named.has(ref.path))) return null;
  return own.filter((ref) => named.has(ref.path));
}

/** `path`'s real path, as `findWorktreeRoot` resolves the root; `null` when it does not exist. */
function realPath(path: string): string | null {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

/** Whether `path` is a file, as Jest's config search asks; a symbolic link to one is. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The string scripts of the `package.json` in `dir`; none when it is missing or unreadable. */
function scriptsIn(dir: string): Readonly<Record<string, string>> {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return {};
    return Object.fromEntries(
      Object.entries(manifest.scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
