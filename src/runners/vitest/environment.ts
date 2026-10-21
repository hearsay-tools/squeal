import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { compare, sameList } from "../../core/fs/index.js";
import type { AbsolutePath, RelativePath, RunnerEnvironment } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { configFiles, globalSetupFiles, type ProjectInputs } from "./project.js";

export interface EnvironmentContext {
  readonly paths: WorktreePaths;
  readonly runnerVersion: string;
  readonly adapterVersion: string;
  /**
   * What the runtime-input recorder added to the workers' env (task
   * 001-132), left out of the resolved config: its directory differs per
   * instance, and Vitest copies the `env` option into a root project's config.
   */
  readonly injected?: Readonly<Record<string, string>>;
}

/**
 * Runner-side environment hash inputs of one project.
 *
 * Spec 001 D3: "the resolved Vitest config, the contents of the config file
 * and its `configFileDependencies`, the closure of every `setupFiles` and
 * `globalSetup` entry". The adapter lists the files, and every resolution
 * candidate of a missing import of those closures, as a test file's closure
 * does (task 001-424); the core hashes them, a missing one as absent. Where
 * every project's config files, which the key definition before task 011-85
 * listed, give another list, it is `formerFiles` (011 C3, C14).
 */
export function projectEnvironment(
  project: TestProject,
  inputs: ProjectInputs,
  context: EnvironmentContext,
): RunnerEnvironment {
  const { paths } = context;
  const files = environmentFiles(inputs.configFiles, inputs, paths);
  const former = environmentFiles(configFiles(project.vitest), inputs, paths);
  return {
    project: project.name,
    runnerName: "vitest",
    runnerVersion: context.runnerVersion,
    adapterVersion: context.adapterVersion,
    resolvedConfig: canonicalConfig(project, paths, context.injected),
    files,
    ...(sameList(former, files) ? {} : { formerFiles: former }),
  };
}

/** The project files among `configs` and the setup closures, relative and sorted. */
function environmentFiles(
  configs: ReadonlySet<AbsolutePath>,
  inputs: ProjectInputs,
  paths: WorktreePaths,
): RelativePath[] {
  const files = new Set<RelativePath>();
  const inputFiles = [
    ...configs,
    ...inputs.setup.files,
    ...inputs.globalSetup.files,
    ...inputs.missing,
  ];
  for (const file of inputFiles) {
    const rel = paths.toRelative(file);
    if (rel !== null && paths.isProjectFile(file)) files.add(rel);
  }
  return [...files].sort(compare);
}

/**
 * Canonical JSON of the config tests receive (`serializedConfig`), plus
 * `globalSetup`, which runs in the main process and is not serialized.
 * `sequence.seed` is dropped: Vitest draws it from the clock on every start.
 * Keys sorted, absolute paths relativized to the worktree root. The env the
 * recorder added (`injected`) is left out, and so is its `--import` or
 * `--require` ahead of a project's own `NODE_OPTIONS` (tasks 001-132, 001-390). So are `disableColors`
 * (Vitest 5) and `isAgent` (Vitest 4): std-env's agent detection, which
 * workers read only to turn colours off; keyed, they made the launching
 * harness re-key every check (task 001-260). What `CI` sets stays keyed:
 * `allowOnly` and `browser.*` change outcomes. `maxWorkers` is dropped too:
 * each tier runs at its grant, under the project's own value (D11 Capacity,
 * task 001-378), and worktrees with different grants share results.
 */
export function canonicalConfig(
  project: TestProject,
  paths: WorktreePaths,
  injected: Readonly<Record<string, string>> = {},
): string {
  const {
    sequence,
    env,
    disableColors: _colors,
    isAgent: _agent,
    maxWorkers: _workers,
    ...config
  } = project.serializedConfig as typeof project.serializedConfig & { isAgent?: unknown };
  const { seed: _seed, ...stableSequence } = sequence;
  return JSON.stringify(
    canonicalize(
      {
        ...config,
        ...(env === undefined ? {} : { env: withoutInjected(env, injected) }),
        sequence: stableSequence,
        globalSetup: globalSetupFiles(project),
      },
      paths,
    ),
  );
}

function withoutInjected(
  env: Readonly<Record<string, unknown>>,
  injected: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const recorder = recorderOf(injected.NODE_OPTIONS);
  for (const [key, value] of Object.entries(env)) {
    if (injected[key] !== undefined && value === injected[key]) continue;
    const option = key === "NODE_OPTIONS" && typeof value === "string" ? leading(value) : null;
    if (option !== null && recorder !== null && recorderOf(option.token) === recorder) {
      out[key] = option.rest;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The leading `--import "…"` or `--require "…"` of a `NODE_OPTIONS`, and what follows it. */
function leading(options: string): { readonly token: string; readonly rest: string } | null {
  const token = options.match(/^--(?:import|require) "[^"]*"/)?.[0];
  return token === undefined || options[token.length] !== " "
    ? null
    : { token, rest: options.slice(token.length + 1) };
}

/** The recorder file a leading `--import` or `--require` names, a `file:` URL as its path. */
function recorderOf(options: string | undefined): string | null {
  const value = options?.match(/^--(?:import|require) "([^"]*)"/)?.[1];
  if (value === undefined) return null;
  try {
    return value.startsWith("file:") ? fileURLToPath(value) : value;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown, paths: WorktreePaths): unknown {
  if (typeof value === "string") return paths.relativizeText(value);
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, paths));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => compare(a, b))
      .map(([k, v]) => [k, canonicalize(v, paths)]);
    return Object.fromEntries(entries);
  }
  return value;
}
